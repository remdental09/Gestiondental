// Conexión local entre la capturadora y SpeakDent, solo dentro del mismo computador (127.0.0.1).
// - Solo responde a las direcciones de SpeakDent (cabecera Origin) y a su propio nombre (cabecera Host).
// - La ficha abierta se anota con un identificador de sesión; cada captura queda marcada para la sesión
//   que estaba escuchando en ese momento y solo esa sesión puede leerla.
// - Las imágenes se guardan en memoria unos minutos. La capturadora no sale a internet.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace SpeakDent
{
    class Resultado
    {
        public bool Ok; public string Error;
        public static Resultado Bien() { return new Resultado { Ok = true }; }
        public static Resultado Mal(string error) { return new Resultado { Ok = false, Error = error }; }
    }

    interface IAnfitrion
    {
        string Visor();     // nombre del visor abierto, o null
        string Tecla();     // "F8", "F9" o null
        string Titulo();    // título de la ventana del visor (puede traer el nombre del paciente), o null
        string[] Marcadas(); // vistas con recuadro marcado en ese visor
        Resultado Capturar(string sesion, bool todas); // captura pedida desde la ficha
    }

    // Vistas que se pueden marcar en el visor. La ficha usa estos mismos identificadores.
    static class Vistas
    {
        public static readonly string[] Ids = { "transversal", "axial", "panoramica", "vista3d" };
        public static readonly string[] Nombres = { "Transversal", "Axial", "Panorámica", "Vista 3D" };
        public static bool Conocida(string id) { return Array.IndexOf(Ids, id) >= 0 || id == "radiografia"; }
        public static string Nombre(string id)
        {
            int i = Array.IndexOf(Ids, id);
            return i >= 0 ? Nombres[i] : id == "radiografia" ? "Radiografía" : null;
        }
    }

    class Captura
    {
        public string Id, Sesion, Visor, Vista, Titulo, Aviso;
        public byte[] Png;
        public DateTime Hora;
    }

    class Puente : IDisposable
    {
        public const int Puerto = 47821;
        public const string Version = "0.3";
        public static readonly string[] Origenes = {
            "https://speakdent.cl", "https://www.speakdent.cl",
            "https://gestion-dental-luis-rodriguez.remdental09.workers.dev"
        };
        const int MaxPendientes = 16;
        const int MaxConexiones = 12;

        readonly IAnfitrion anfitrion;
        readonly string[] origenes;
        readonly TimeSpan espera, vigencia, caducidad;
        readonly object candado = new object();
        readonly List<Captura> pendientes = new List<Captura>();
        TcpListener escucha;
        string activa;          // sesión que recibe las capturas
        DateTime visto;         // última señal de esa sesión
        string vista;           // tipo de corte elegido en la ficha activa
        bool completa;          // la ficha pidió la ventana completa en vez del recuadro marcado
        int esperando;          // peticiones de la sesión activa que siguen abiertas
        int conexiones;
        volatile bool cerrado;
        public int PuertoReal;
        public bool Abierto { get { return escucha != null; } }

        public Puente(IAnfitrion anfitrion) : this(anfitrion, Origenes, 20000, 45000, 300000) { }

        public Puente(IAnfitrion anfitrion, string[] origenes, int esperaMs, int vigenciaMs, int caducidadMs)
        {
            this.anfitrion = anfitrion;
            this.origenes = origenes;
            espera = TimeSpan.FromMilliseconds(esperaMs);
            vigencia = TimeSpan.FromMilliseconds(vigenciaMs);
            caducidad = TimeSpan.FromMilliseconds(caducidadMs);
        }

        public void Abrir(int puerto)
        {
            var nueva = new TcpListener(IPAddress.Loopback, puerto);
            nueva.Start(); // si el puerto está ocupado, lanza la excepción y se puede volver a intentar
            escucha = nueva;
            PuertoReal = ((IPEndPoint)escucha.LocalEndpoint).Port;
            var hilo = new Thread(Aceptar) { IsBackground = true, Name = "puente" };
            hilo.Start();
        }

        public void Dispose()
        {
            cerrado = true;
            try { if (escucha != null) escucha.Stop(); } catch (Exception) { }
            lock (candado) { pendientes.Clear(); activa = null; Monitor.PulseAll(candado); }
        }

        // La sesión a la que debe ir una captura hecha ahora, o null si ninguna ficha está escuchando.
        public string SesionActiva()
        {
            lock (candado)
            {
                if (activa == null) return null;
                return esperando > 0 || DateTime.UtcNow - visto < vigencia ? activa : null;
            }
        }

        // Lo que la ficha que escucha quiere recibir con F8.
        public void Preferencia(string sesion, out string vistaElegida, out bool ventanaCompleta)
        {
            lock (candado)
            {
                bool es = sesion != null && sesion == activa;
                vistaElegida = es ? vista : null;
                ventanaCompleta = es && completa;
            }
        }

        public bool Entregar(string sesion, byte[] png, string visor) { return Entregar(sesion, png, visor, null, null, null); }

        public bool Entregar(string sesion, byte[] png, string visor, string vistaCaptura, string titulo, string aviso)
        {
            if (sesion == null || png == null) return false;
            lock (candado)
            {
                Limpiar();
                while (pendientes.Count >= MaxPendientes) pendientes.RemoveAt(0);
                pendientes.Add(new Captura { Id = Guid.NewGuid().ToString("N"), Sesion = sesion, Png = png, Visor = visor, Vista = vistaCaptura, Titulo = titulo, Aviso = aviso, Hora = DateTime.UtcNow });
                Monitor.PulseAll(candado);
            }
            return true;
        }

        // "Deshacer" en la capturadora: la captura que aún no se recogió ya no se envía.
        public void Retirar(byte[] png)
        {
            lock (candado) pendientes.RemoveAll(delegate(Captura c) { return c.Png == png; });
        }

        void Limpiar()
        {
            DateTime limite = DateTime.UtcNow - caducidad;
            pendientes.RemoveAll(delegate(Captura c) { return c.Hora < limite; });
        }

        void Aceptar()
        {
            while (!cerrado)
            {
                TcpClient cliente;
                try { cliente = escucha.AcceptTcpClient(); }
                catch (Exception) { if (cerrado) return; Thread.Sleep(200); continue; }
                if (Interlocked.Increment(ref conexiones) > MaxConexiones)
                {
                    Interlocked.Decrement(ref conexiones);
                    cliente.Close();
                    continue;
                }
                var hilo = new Thread(delegate()
                {
                    try { using (cliente) Atender(cliente); }
                    catch (Exception) { }
                    finally { Interlocked.Decrement(ref conexiones); }
                }) { IsBackground = true };
                hilo.Start();
            }
        }

        static string LeerCabeceras(Stream s)
        {
            var datos = new MemoryStream();
            var uno = new byte[1];
            DateTime limite = DateTime.UtcNow.AddSeconds(5);
            int fin = 0; // avance de \r\n\r\n
            while (datos.Length < 8192 && DateTime.UtcNow < limite)
            {
                if (s.Read(uno, 0, 1) != 1) return null;
                datos.WriteByte(uno[0]);
                if (uno[0] == (fin % 2 == 0 ? '\r' : '\n')) fin++; else fin = uno[0] == '\r' ? 1 : 0;
                if (fin == 4) return Encoding.ASCII.GetString(datos.ToArray());
            }
            return null;
        }

        public static bool SesionValida(string s)
        {
            if (s == null || s.Length < 16 || s.Length > 64) return false;
            foreach (char c in s)
                if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-')) return false;
            return true;
        }

        void Atender(TcpClient cliente)
        {
            cliente.ReceiveTimeout = 5000;
            cliente.SendTimeout = 15000;
            Stream s = cliente.GetStream();
            string texto = LeerCabeceras(s);
            if (texto == null) return;
            string[] lineas = texto.Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
            if (lineas.Length == 0) return;
            string[] primera = lineas[0].Split(new[] { ' ' });
            if (primera.Length != 3) return;
            string metodo = primera[0], destino = primera[1];
            string host = null, origen = null;
            int repetidas = 0;
            for (int i = 1; i < lineas.Length; i++)
            {
                int p = lineas[i].IndexOf(':');
                if (p <= 0) continue;
                string nombre = lineas[i].Substring(0, p).Trim().ToLowerInvariant();
                string valor = lineas[i].Substring(p + 1).Trim();
                if (nombre == "host") { if (host != null) repetidas++; host = valor; }
                if (nombre == "origin") { if (origen != null) repetidas++; origen = valor; }
            }
            if (repetidas > 0 || host != "127.0.0.1:" + PuertoReal || origen == null || Array.IndexOf(origenes, origen) < 0)
            {
                Responder(s, "403 Forbidden", null, "application/json", Utf8("{\"error\":\"origen no permitido\"}"));
                return;
            }
            if (metodo == "OPTIONS") { Responder(s, "204 No Content", origen, null, null); return; }

            string ruta = destino, consulta = "";
            int q = destino.IndexOf('?');
            if (q >= 0) { ruta = destino.Substring(0, q); consulta = destino.Substring(q + 1); }
            var args = new Dictionary<string, string>();
            foreach (string par in consulta.Split(new[] { '&' }, StringSplitOptions.RemoveEmptyEntries))
            {
                int i = par.IndexOf('=');
                if (i > 0) args[par.Substring(0, i)] = Uri.UnescapeDataString(par.Substring(i + 1));
            }

            if (metodo == "GET" && ruta == "/estado") { Json(s, origen, "{" + Identidad() + "}"); return; }

            string sesion; args.TryGetValue("sesion", out sesion);
            if (!SesionValida(sesion)) { Responder(s, "400 Bad Request", origen, "application/json", Utf8("{\"error\":\"falta la sesión\"}")); return; }
            string id; args.TryGetValue("id", out id);
            string pedida; args.TryGetValue("vista", out pedida);
            if (pedida != null && !Vistas.Conocida(pedida)) pedida = null;
            string encuadre; args.TryGetValue("encuadre", out encuadre);

            if (metodo == "POST" && ruta == "/escuchar")
            {
                lock (candado)
                {
                    if (activa != sesion) { activa = sesion; esperando = 0; }
                    vista = pedida; completa = encuadre == "completo";
                    visto = DateTime.UtcNow;
                    Monitor.PulseAll(candado);
                }
                Json(s, origen, "{\"ok\":true," + Identidad() + Estudio() + "}");
            }
            else if (metodo == "POST" && ruta == "/ajustar")
            {
                bool es;
                lock (candado)
                {
                    es = activa == sesion;
                    if (es) { vista = pedida; completa = encuadre == "completo"; visto = DateTime.UtcNow; }
                }
                Json(s, origen, es ? "{\"ok\":true}" : "{\"ok\":false}");
            }
            else if (metodo == "GET" && ruta == "/esperar") Json(s, origen, Esperar(sesion));
            else if (metodo == "GET" && ruta == "/imagen")
            {
                byte[] png = null;
                lock (candado) foreach (var c in pendientes) if (c.Sesion == sesion && c.Id == id) png = c.Png;
                if (png == null) Responder(s, "404 Not Found", origen, "application/json", Utf8("{\"error\":\"la captura ya no está\"}"));
                else Responder(s, "200 OK", origen, "image/png", png);
            }
            else if (metodo == "POST" && ruta == "/recibida")
            {
                lock (candado) pendientes.RemoveAll(delegate(Captura c) { return c.Sesion == sesion && c.Id == id; });
                Json(s, origen, "{\"ok\":true}");
            }
            else if (metodo == "POST" && ruta == "/capturar")
            {
                bool puede;
                lock (candado) { puede = activa == sesion; if (puede) visto = DateTime.UtcNow; }
                string todas; args.TryGetValue("todas", out todas);
                Resultado r = puede ? anfitrion.Capturar(sesion, todas == "1") : Resultado.Mal("Otra ficha está recibiendo las capturas.");
                Json(s, origen, r.Ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":" + Texto(r.Error) + "}");
            }
            else if (metodo == "POST" && ruta == "/soltar")
            {
                lock (candado)
                {
                    if (activa == sesion) activa = null;
                    pendientes.RemoveAll(delegate(Captura c) { return c.Sesion == sesion; });
                    Monitor.PulseAll(candado);
                }
                Json(s, origen, "{\"ok\":true}");
            }
            else Responder(s, "404 Not Found", origen, "application/json", Utf8("{\"error\":\"no existe\"}"));
        }

        // Espera hasta que haya capturas para la sesión, otra ficha tome el turno o venza el plazo.
        string Esperar(string sesion)
        {
            DateTime limite = DateTime.UtcNow + espera;
            lock (candado)
            {
                bool cuenta = activa == sesion;
                if (cuenta) { esperando++; visto = DateTime.UtcNow; }
                try
                {
                    while (true)
                    {
                        Limpiar();
                        var lista = new StringBuilder();
                        foreach (var c in pendientes)
                        {
                            if (c.Sesion != sesion) continue;
                            if (lista.Length > 0) lista.Append(',');
                            lista.Append("{\"id\":").Append(Texto(c.Id)).Append(",\"visor\":").Append(Texto(c.Visor))
                                .Append(",\"vista\":").Append(Texto(c.Vista)).Append(",\"titulo\":").Append(Texto(c.Titulo))
                                .Append(",\"aviso\":").Append(Texto(c.Aviso)).Append('}');
                        }
                        TimeSpan resta = limite - DateTime.UtcNow;
                        if (lista.Length > 0 || activa != sesion || cerrado || resta <= TimeSpan.Zero)
                            return "{\"activa\":" + (activa == sesion ? "true" : "false") + ",\"capturas\":[" + lista + "]," + Identidad() + (activa == sesion ? Estudio() : "") + "}";
                        Monitor.Wait(candado, resta);
                    }
                }
                finally
                {
                    if (cuenta && activa == sesion) { if (esperando > 0) esperando--; visto = DateTime.UtcNow; }
                }
            }
        }

        string Identidad()
        {
            return "\"app\":\"capturadora-speakdent\",\"version\":" + Texto(Version) + ",\"visor\":" + Texto(anfitrion.Visor()) + ",\"tecla\":" + Texto(anfitrion.Tecla());
        }

        // El título del visor solo va a la ficha que tiene el turno, nunca en /estado.
        string Estudio()
        {
            var marcadas = new StringBuilder();
            foreach (string m in anfitrion.Marcadas())
            {
                if (marcadas.Length > 0) marcadas.Append(',');
                marcadas.Append(Texto(m));
            }
            return ",\"titulo\":" + Texto(anfitrion.Titulo()) + ",\"marcadas\":[" + marcadas + "]";
        }

        public static string Texto(string valor)
        {
            if (valor == null) return "null";
            var b = new StringBuilder("\"");
            foreach (char c in valor)
            {
                if (c == '"' || c == '\\') b.Append('\\').Append(c);
                else if (c < ' ' || c == (char)0x2028 || c == (char)0x2029) b.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                else b.Append(c);
            }
            return b.Append('"').ToString();
        }

        static byte[] Utf8(string s) { return new UTF8Encoding(false).GetBytes(s); }

        void Json(Stream s, string origen, string cuerpo) { Responder(s, "200 OK", origen, "application/json; charset=utf-8", Utf8(cuerpo)); }

        static void Responder(Stream s, string estado, string origen, string tipo, byte[] cuerpo)
        {
            var h = new StringBuilder("HTTP/1.1 " + estado + "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n");
            if (origen != null)
            {
                h.Append("Access-Control-Allow-Origin: ").Append(origen).Append("\r\nVary: Origin\r\n");
                h.Append("Access-Control-Allow-Methods: GET, POST\r\nAccess-Control-Allow-Private-Network: true\r\n");
            }
            if (tipo != null) h.Append("Content-Type: ").Append(tipo).Append("\r\n");
            h.Append("Content-Length: ").Append(cuerpo == null ? 0 : cuerpo.Length).Append("\r\n\r\n");
            byte[] cabeza = Encoding.ASCII.GetBytes(h.ToString());
            s.Write(cabeza, 0, cabeza.Length);
            if (cuerpo != null) s.Write(cuerpo, 0, cuerpo.Length);
            s.Flush();
        }
    }
}
