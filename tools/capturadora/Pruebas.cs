// Pruebas de la lógica que no depende de Windows.
using System;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using SpeakDent;
class Falso : IAnfitrion
{
    public string Nombre = "Blue Sky \"Plan\"";
    public string Pedida;
    public Puente Puente;
    public string Visor() { return Nombre; }
    public string Tecla() { return "F8"; }
    public Resultado Capturar(string sesion)
    {
        Pedida = sesion;
        if (Nombre == null) return Resultado.Mal("No veo un visor abierto.");
        Puente.Entregar(sesion, new byte[] { 137, 80, 78, 71, 1, 2, 3 }, Nombre);
        return Resultado.Bien();
    }
}
static class Pruebas
{
    static int fails, total;
    static void Check(string name, bool ok) { total++; if (!ok) { fails++; Console.WriteLine("FALLA: " + name); } }
    const string Sitio = "https://speakdent.cl";
    const string A = "aaaaaaaa-1111-2222-3333-444444444444", B = "bbbbbbbb-1111-2222-3333-444444444444";

    class Respuesta { public int Codigo; public string Cabeceras, Texto; public byte[] Cuerpo; }

    static Respuesta Pedir(Puente p, string metodo, string ruta, string origen = Sitio, string host = null)
    {
        using (var c = new TcpClient("127.0.0.1", p.PuertoReal))
        {
            var s = c.GetStream();
            string h = metodo + " " + ruta + " HTTP/1.1\r\nHost: " + (host ?? "127.0.0.1:" + p.PuertoReal) + "\r\n" + (origen == null ? "" : "Origin: " + origen + "\r\n") + "\r\n";
            var b = Encoding.ASCII.GetBytes(h);
            s.Write(b, 0, b.Length);
            var m = new MemoryStream();
            s.CopyTo(m);
            var todo = m.ToArray();
            var latin = Encoding.GetEncoding(28591).GetString(todo);
            int corte = latin.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            var cuerpo = new byte[todo.Length - corte - 4];
            Array.Copy(todo, corte + 4, cuerpo, 0, cuerpo.Length);
            return new Respuesta { Codigo = int.Parse(latin.Substring(9, 3)), Cabeceras = latin.Substring(0, corte), Cuerpo = cuerpo, Texto = Encoding.UTF8.GetString(cuerpo) };
        }
    }
    static string Id(string json) { var m = Regex.Match(json, "\"id\":\"([0-9a-f]{32})\""); return m.Success ? m.Groups[1].Value : null; }

    static void ProbarPuente()
    {
        var host = new Falso();
        using (var p = new Puente(host, Puente.Origenes, 600, 900, 60000))
        {
            host.Puente = p;
            p.Abrir(0);
            var ajeno = Pedir(p, "GET", "/estado", "https://otro.example");
            Check("otro sitio rechazado", ajeno.Codigo == 403 && !ajeno.Cabeceras.Contains("Access-Control-Allow-Origin"));
            Check("sin origen rechazado", Pedir(p, "GET", "/estado", null).Codigo == 403);
            Check("origen parecido rechazado", Pedir(p, "GET", "/estado", "https://speakdent.cl.example").Codigo == 403);
            Check("http rechazado", Pedir(p, "GET", "/estado", "http://speakdent.cl").Codigo == 403);
            Check("otro nombre de host rechazado", Pedir(p, "GET", "/estado", Sitio, "evil.example:" + p.PuertoReal).Codigo == 403);
            Check("otro sitio no captura", Pedir(p, "POST", "/capturar?sesion=" + A, "https://otro.example").Codigo == 403 && host.Pedida == null);
            var previa = Pedir(p, "OPTIONS", "/capturar");
            Check("consulta previa", previa.Codigo == 204 && previa.Cabeceras.Contains("Access-Control-Allow-Origin: " + Sitio));
            var estado = Pedir(p, "GET", "/estado");
            Check("estado", estado.Codigo == 200 && estado.Texto.Contains("capturadora-speakdent") && estado.Texto.Contains("Blue Sky \\\"Plan\\\"") && estado.Texto.Contains("\"tecla\":\"F8\""));
            Check("sesión corta rechazada", Pedir(p, "POST", "/escuchar?sesion=abc").Codigo == 400);
            Check("sesión rara rechazada", Pedir(p, "POST", "/escuchar?sesion=" + A + "%22").Codigo == 400);
            Check("nadie escucha al inicio", p.SesionActiva() == null);
            Check("sin sesión no se entrega", !p.Entregar(null, new byte[1], "x"));
            Check("sin escuchar no se captura", Pedir(p, "POST", "/capturar?sesion=" + A).Texto.Contains("\"ok\":false") && host.Pedida == null);
            Pedir(p, "POST", "/escuchar?sesion=" + A);
            Check("escucha A", p.SesionActiva() == A);
            Check("captura pedida", Pedir(p, "POST", "/capturar?sesion=" + A).Texto.Contains("\"ok\":true") && host.Pedida == A);
            var lista = Pedir(p, "GET", "/esperar?sesion=" + A);
            string id = Id(lista.Texto);
            Check("A recibe la captura", lista.Texto.Contains("\"activa\":true") && id != null);
            Check("B no la ve", !Pedir(p, "GET", "/esperar?sesion=" + B).Texto.Contains(id));
            Check("B no la lee", Pedir(p, "GET", "/imagen?sesion=" + B + "&id=" + id).Codigo == 404);
            Pedir(p, "POST", "/recibida?sesion=" + B + "&id=" + id);
            var png = Pedir(p, "GET", "/imagen?sesion=" + A + "&id=" + id);
            Check("A lee la imagen", png.Codigo == 200 && png.Cuerpo.Length == 7 && png.Cuerpo[0] == 137 && png.Cabeceras.Contains("image/png"));
            Pedir(p, "POST", "/recibida?sesion=" + A + "&id=" + id);
            Check("recibida se borra", Pedir(p, "GET", "/imagen?sesion=" + A + "&id=" + id).Codigo == 404);

            // La espera termina apenas llega una captura.
            var reloj = System.Diagnostics.Stopwatch.StartNew();
            Respuesta tarde = null;
            var hilo = new Thread(delegate() { tarde = Pedir(p, "GET", "/esperar?sesion=" + A); });
            hilo.Start(); Thread.Sleep(150);
            var datos = new byte[] { 9, 9 };
            p.Entregar(A, datos, "Blue Sky Plan");
            hilo.Join(3000);
            Check("espera despierta con la captura", tarde != null && Id(tarde.Texto) != null && reloj.ElapsedMilliseconds < 550);
            p.Retirar(datos);
            Check("deshacer retira la captura", Id(Pedir(p, "GET", "/esperar?sesion=" + A).Texto) == null);

            // Otra ficha toma el turno: la primera se entera y las capturas nuevas van a la segunda.
            Respuesta cambio = null;
            hilo = new Thread(delegate() { cambio = Pedir(p, "GET", "/esperar?sesion=" + A); });
            hilo.Start(); Thread.Sleep(150);
            Pedir(p, "POST", "/escuchar?sesion=" + B);
            hilo.Join(3000);
            Check("A sabe que ya no recibe", cambio != null && cambio.Texto.Contains("\"activa\":false"));
            Check("ahora recibe B", p.SesionActiva() == B);
            Check("A no puede pedir captura", Pedir(p, "POST", "/capturar?sesion=" + A).Texto.Contains("\"ok\":false"));
            p.Entregar(p.SesionActiva(), new byte[] { 5 }, "x");
            Check("captura va a B", Id(Pedir(p, "GET", "/esperar?sesion=" + B).Texto) != null && Id(Pedir(p, "GET", "/esperar?sesion=" + A).Texto) == null);
            Pedir(p, "POST", "/soltar?sesion=" + B);
            Check("soltar apaga y borra", p.SesionActiva() == null && Id(Pedir(p, "GET", "/esperar?sesion=" + B).Texto) == null);

            host.Nombre = null;
            Pedir(p, "POST", "/escuchar?sesion=" + A);
            Check("error de captura llega a la ficha", Pedir(p, "POST", "/capturar?sesion=" + A).Texto.Contains("No veo un visor abierto."));
            Thread.Sleep(1100);
            Check("sesión sin señales deja de recibir", p.SesionActiva() == null);
            for (int i = 0; i < 20; i++) p.Entregar(A, new byte[] { (byte)i }, "x");
            Check("cola limitada", Regex.Matches(Pedir(p, "GET", "/esperar?sesion=" + A).Texto, "\"id\"").Count == 12);
            Check("ruta desconocida", Pedir(p, "GET", "/archivos?sesion=" + A).Codigo == 404);
        }
        using (var p = new Puente(host, Puente.Origenes, 50, 900, 100))
        {
            p.Abrir(0);
            p.Entregar(A, new byte[] { 1 }, "x");
            Thread.Sleep(200);
            Check("captura vieja caduca", Id(Pedir(p, "GET", "/esperar?sesion=" + A).Texto) == null);
        }
    }

    static int Main(string[] args)
    {
        Check("proceso Blue Sky", Windows.Recognize("BlueSkyPlan", "Paciente X") == "Blue Sky Plan");
        Check("título Blue Sky", Windows.Recognize("bsp", "Blue Sky Plan 4") == "Blue Sky Plan");
        Check("navegador ignorado", Windows.Recognize("chrome", "Blue Sky Plan - descarga") == null);
        Check("explorador ignorado", Windows.Recognize("explorer", "Romexis") == null);
        Check("programa ajeno", Windows.Recognize("notepad", "notas.txt") == null);
        Check("laminador 3D no es visor", Windows.Recognize("prusa-slicer", "pieza.stl - PrusaSlicer") == null);
        Check("RadiAnt", Windows.Recognize("RadiAntViewer", "CBCT") == "RadiAnt");
        var viewer = new WindowInfo { ByProcess = true, Area = 100 };
        var manual = new WindowInfo { ByProcess = false, Area = 900 };
        Check("programa gana a título", Windows.Better(viewer, manual) && !Windows.Better(manual, viewer));
        Check("primera candidata", Windows.Better(manual, null));
        var s = new Settings();
        var crop = new RectangleF(0.1f, 0.2f, 0.5f, 0.25f);
        s.SetCrop("BlueSkyPlan", crop);
        var read = new Settings().GetCrop("BlueSkyPlan");
        Check("recorte se recuerda", read != null && Math.Abs(read.Value.X - 0.1f) < 1e-5 && Math.Abs(read.Value.Height - 0.25f) < 1e-5);
        new Settings().SetCrop("BlueSkyPlan", null);
        Check("recorte se quita", new Settings().GetCrop("BlueSkyPlan") == null);
        new Settings().Set("recorte.malo", "a;b;c;d");
        Check("recorte dañado se ignora", new Settings().GetCrop("malo") == null);
        Check("orden de inicio", Inicio.Orden(@"C:\Con espacios\C.exe") == "\"C:\\Con espacios\\C.exe\" --en-segundo-plano");
        Check("desde temporal no se registra", !Inicio.RutaEstable(@"C:\Users\x\AppData\Local\Temp\zip\C.exe", @"C:\Users\x\AppData\Local\Temp\"));
        Check("carpeta normal sí", Inicio.RutaEstable(@"C:\Users\x\Documents\C.exe", @"C:\Users\x\AppData\Local\Temp\"));
        ProbarPuente();
        var asm = Assembly.LoadFrom(args[0]);
        foreach (var r in asm.GetReferencedAssemblies()) Console.WriteLine("usa " + r.Name + " " + r.Version);
        Console.WriteLine((total - fails) + "/" + total + " pruebas correctas");
        return fails == 0 ? 0 : 1;
    }
}
