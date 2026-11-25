// Capturadora SpeakDent — versión de prueba para Windows.
// Captura la ventana del visor DICOM cuando el usuario lo pide (F8, botón o botón de la ficha).
// No usa internet: guarda en Imágenes\SpeakDent, copia al portapapeles y, si una ficha de SpeakDent
// abierta en este mismo computador está escuchando, le entrega la imagen (ver Puente.cs).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Capturadora SpeakDent")]
[assembly: AssemblyProduct("SpeakDent")]
[assembly: AssemblyDescription("Captura imágenes del visor DICOM a pedido del usuario. Versión de prueba.")]
[assembly: AssemblyVersion("0.3.0.0")]
[assembly: AssemblyFileVersion("0.3.0.0")]

namespace SpeakDent
{
    static class Win32
    {
        public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int max);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
        [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
        [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT value, int size);
        [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] public static extern int DwmGetWindowAttributeInt(IntPtr h, int attr, out int value, int size);
    }

    class WindowInfo
    {
        public IntPtr Handle;
        public uint Pid;
        public string Process;
        public string Title;
        public long Area;
        public string Viewer; // nombre del visor reconocido, o null
        public bool ByProcess; // reconocido por el nombre del programa, no solo por el título
        public override string ToString()
        {
            string t = Title.Length > 45 ? Title.Substring(0, 45) + "…" : Title;
            return (Viewer ?? Process) + " — " + t;
        }
    }

    static class Windows
    {
        // clave (sin espacios ni guiones, en minúsculas) -> nombre visible
        static readonly string[,] Known = {
            {"blueskyplan", "Blue Sky Plan"}, {"blueskybio", "Blue Sky Plan"},
            {"romexis", "Planmeca Romexis"}, {"radiant", "RadiAnt"},
            {"ondemand3d", "OnDemand3D"}, {"ez3d", "Ez3D"}, {"invivo", "InVivo"},
            {"sidexis", "Sidexis"}, {"galileos", "Galileos"}, {"weasis", "Weasis"},
            {"3dslicer", "3D Slicer"}, {"slicerapp", "3D Slicer"},
            {"codiagnostix", "coDiagnostiX"}, {"csimaging", "CS Imaging"}, {"cs3dimaging", "CS 3D Imaging"},
            {"onevolumeviewer", "One Volume Viewer"}, {"idixel", "i-Dixel"},
            {"dtxstudio", "DTX Studio"}, {"exoplan", "exoplan"}, {"implantstudio", "Implant Studio"},
            {"microdicom", "MicroDicom"}, {"nntviewer", "NNT Viewer"}, {"dicomviewer", "Visor DICOM"}
        };
        static readonly string[] Ignored = { "chrome", "msedge", "firefox", "opera", "brave", "iexplore", "explorer", "winword", "outlook", "whatsapp" };

        static string Normalize(string s)
        {
            var b = new StringBuilder();
            foreach (char c in s.ToLowerInvariant()) if (char.IsLetterOrDigit(c)) b.Append(c);
            return b.ToString();
        }

        public static string Recognize(string process, string title)
        {
            string p = Normalize(process), t = Normalize(title);
            foreach (string i in Ignored) if (p == i) return null;
            for (int k = 0; k < Known.GetLength(0); k++)
                if (p.Contains(Known[k, 0]) || t.Contains(Known[k, 0])) return Known[k, 1];
            return null;
        }

        public const string Preferred = "Blue Sky Plan";

        // Un programa reconocido pesa más que una ventana que solo menciona el visor en su título;
        // entre programas, Blue Sky Plan va primero.
        public static bool Better(WindowInfo a, WindowInfo b)
        {
            if (b == null) return true;
            if (a.ByProcess != b.ByProcess) return a.ByProcess;
            bool pa = a.Viewer == Preferred, pb = b.Viewer == Preferred;
            if (pa != pb) return pa;
            return a.Area > b.Area;
        }

        public static List<WindowInfo> List()
        {
            var list = new List<WindowInfo>();
            uint own = (uint)Process.GetCurrentProcess().Id;
            Win32.EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                if (!Win32.IsWindowVisible(h)) return true;
                var sb = new StringBuilder(512);
                Win32.GetWindowText(h, sb, sb.Capacity);
                if (sb.Length == 0) return true;
                uint pid; Win32.GetWindowThreadProcessId(h, out pid);
                if (pid == own) return true;
                try
                {
                    int cloaked;
                    if (Win32.DwmGetWindowAttributeInt(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
                }
                catch (Exception) { }
                Win32.RECT r; Win32.GetWindowRect(h, out r);
                long w = r.Right - r.Left, ht = r.Bottom - r.Top;
                if (!Win32.IsIconic(h) && (w < 300 || ht < 200)) return true;
                string name = "ventana";
                try { using (var proc = Process.GetProcessById((int)pid)) name = proc.ProcessName; }
                catch (Exception) { }
                var info = new WindowInfo { Handle = h, Pid = pid, Process = name, Title = sb.ToString(), Area = Win32.IsIconic(h) ? 0 : w * ht };
                info.Viewer = Recognize(name, info.Title);
                info.ByProcess = Recognize(name, "") != null;
                list.Add(info);
                return true;
            }, IntPtr.Zero);
            return list;
        }

        // Si el usuario eligió una ventana, se usa su programa; si no, el visor en primer plano o el más grande.
        public static WindowInfo Target(string chosenProcess)
        {
            var all = List();
            IntPtr front = Win32.GetForegroundWindow();
            WindowInfo best = null;
            if (!string.IsNullOrEmpty(chosenProcess))
            {
                foreach (var w in all)
                {
                    if (w.Process != chosenProcess) continue;
                    if (w.Handle == front) return w;
                    if (best == null || w.Area > best.Area) best = w;
                }
                return best;
            }
            foreach (var w in all)
            {
                if (w.Viewer == null) continue;
                // El visor que está delante gana; una página que solo lo menciona en su título no.
                if (w.Handle == front && w.ByProcess) return w;
                if (Better(w, best)) best = w;
            }
            return best;
        }
    }

    class Settings
    {
        readonly string path;
        readonly Dictionary<string, string> values = new Dictionary<string, string>();
        public Settings()
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SpeakDent");
            path = Path.Combine(dir, "capturadora.ini");
            try
            {
                if (File.Exists(path))
                    foreach (string line in File.ReadAllLines(path))
                    {
                        int i = line.IndexOf('=');
                        if (i > 0) values[line.Substring(0, i)] = line.Substring(i + 1);
                    }
            }
            catch (Exception) { }
        }
        public string Get(string key) { string v; return values.TryGetValue(key, out v) ? v : ""; }
        public void Set(string key, string value)
        {
            if (string.IsNullOrEmpty(value)) values.Remove(key); else values[key] = value;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                var lines = new List<string>();
                foreach (var kv in values) lines.Add(kv.Key + "=" + kv.Value);
                File.WriteAllLines(path, lines.ToArray());
            }
            catch (Exception) { }
        }
        // Los recuadros se guardan como fracciones de la ventana, junto con el tamaño que tenía al marcarlos.
        static string Key(string process, string view) { return "vista." + process + "." + view; }
        public RectangleF? GetRegion(string process, string view)
        {
            string[] p = Get(Key(process, view)).Split(new[] { ';' });
            if (p.Length != 4) return null;
            var n = new float[4];
            for (int i = 0; i < 4; i++)
                if (!float.TryParse(p[i], NumberStyles.Float, CultureInfo.InvariantCulture, out n[i])) return null;
            if (!(n[0] >= 0 && n[1] >= 0 && n[2] > 0 && n[3] > 0 && n[0] < 1 && n[1] < 1)) return null;
            return new RectangleF(n[0], n[1], n[2], n[3]);
        }
        public void SetRegion(string process, string view, RectangleF? c)
        {
            Set(Key(process, view), c == null ? "" : string.Format(CultureInfo.InvariantCulture, "{0};{1};{2};{3}",
                c.Value.X, c.Value.Y, c.Value.Width, c.Value.Height));
        }
        public string[] Marked(string process)
        {
            var list = new List<string>();
            foreach (string id in Vistas.Ids) if (GetRegion(process, id) != null) list.Add(id);
            return list.ToArray();
        }
        public void SetMarkedSize(string process, Size size) { Set("tamano." + process, size.Width + "x" + size.Height); }
        // Si la ventana cambió de tamaño o de forma, los recuadros pueden haberse corrido.
        public bool SizeChanged(string process, Size now)
        {
            string[] p = Get("tamano." + process).Split(new[] { 'x' });
            int w, h;
            if (p.Length != 2 || !int.TryParse(p[0], out w) || !int.TryParse(p[1], out h)) return false;
            return Math.Abs(w - now.Width) > w * 0.02 || Math.Abs(h - now.Height) > h * 0.02;
        }
        public static Rectangle Pixels(RectangleF c, Size size)
        {
            return Rectangle.Intersect(new Rectangle(Point.Empty, size), new Rectangle(
                (int)Math.Round(c.X * size.Width), (int)Math.Round(c.Y * size.Height),
                (int)Math.Round(c.Width * size.Width), (int)Math.Round(c.Height * size.Height)));
        }
    }

    // «Abrir sola al encender el computador»: una entrada en el registro de este usuario, sin permisos de administrador.
    static class Inicio
    {
        const string Clave = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string Nombre = "SpeakDentCapturadora";
        public const string Silencio = "--en-segundo-plano";
        public static string Orden(string exe) { return "\"" + exe + "\" " + Silencio; }
        // Desde la carpeta temporal (abrir el .exe dentro del .zip) la ruta desaparece: no sirve para iniciar.
        public static bool RutaEstable(string exe, string temporal)
        {
            return !exe.StartsWith(temporal.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase);
        }
        public static bool Activo()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(Clave)) return k != null && k.GetValue(Nombre) != null;
        }
        public static void Cambiar(bool activar)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(Clave))
            {
                if (activar) k.SetValue(Nombre, Orden(Application.ExecutablePath));
                else k.DeleteValue(Nombre, false);
            }
        }
    }

    // Se arrastra una vez sobre cada vista del visor. Espacio deja una como estaba; Esc termina.
    class CropForm : Form
    {
        readonly Bitmap image;
        readonly RectangleF?[] regions;
        Point start; Rectangle selection; bool dragging;
        int step;
        public bool Changed;
        public RectangleF?[] Regions { get { return regions; } }

        public CropForm(Bitmap bmp, RectangleF?[] current)
        {
            image = bmp;
            regions = (RectangleF?[])current.Clone();
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Maximized;
            TopMost = true; DoubleBuffered = true; KeyPreview = true;
            BackColor = Color.Black; Cursor = Cursors.Cross;
        }
        Rectangle ImageArea()
        {
            float s = Math.Min((float)ClientSize.Width / image.Width, (float)ClientSize.Height / image.Height);
            int w = (int)(image.Width * s), h = (int)(image.Height * s);
            return new Rectangle((ClientSize.Width - w) / 2, (ClientSize.Height - h) / 2, w, h);
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            Rectangle area = ImageArea();
            e.Graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
            e.Graphics.DrawImage(image, area);
            using (var f = new Font("Segoe UI", 13, FontStyle.Bold))
            {
                for (int i = 0; i < regions.Length; i++)
                {
                    if (regions[i] == null) continue;
                    Rectangle r = Settings.Pixels(regions[i].Value, area.Size);
                    r.Offset(area.Location);
                    using (var pen = new Pen(i == step ? Color.Orange : Color.LimeGreen, 2)) e.Graphics.DrawRectangle(pen, r);
                    e.Graphics.DrawString(Vistas.Nombres[i], f, Brushes.LimeGreen, r.X + 4, r.Y + 4);
                }
                if (selection.Width > 0)
                    using (var pen = new Pen(Color.Yellow, 3)) e.Graphics.DrawRectangle(pen, selection);
                string msg = string.Format("{0} de {1}: arrastra sobre la vista {2}.   Espacio: saltar.   Esc: terminar.",
                    step + 1, Vistas.Ids.Length, Vistas.Nombres[step].ToUpperInvariant());
                var size = e.Graphics.MeasureString(msg, f);
                float x = (ClientSize.Width - size.Width) / 2, y = ClientSize.Height - size.Height - 30;
                e.Graphics.FillRectangle(Brushes.Black, x - 8, y - 6, size.Width + 16, size.Height + 12);
                e.Graphics.DrawString(msg, f, Brushes.Yellow, x, y);
            }
        }
        void Next()
        {
            selection = Rectangle.Empty;
            if (step == Vistas.Ids.Length - 1) { Close(); return; }
            step++;
            Invalidate();
        }
        protected override void OnMouseDown(MouseEventArgs e) { if (e.Button != MouseButtons.Left) return; start = e.Location; dragging = true; selection = Rectangle.Empty; Invalidate(); }
        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (!dragging) return;
            selection = Rectangle.FromLTRB(Math.Min(start.X, e.X), Math.Min(start.Y, e.Y), Math.Max(start.X, e.X), Math.Max(start.Y, e.Y));
            Invalidate();
        }
        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (!dragging) return;
            dragging = false;
            Rectangle area = ImageArea();
            Rectangle s = Rectangle.Intersect(selection, area);
            if (s.Width < 20 || s.Height < 20) { selection = Rectangle.Empty; Invalidate(); return; }
            regions[step] = new RectangleF((s.X - area.X) / (float)area.Width, (s.Y - area.Y) / (float)area.Height,
                s.Width / (float)area.Width, s.Height / (float)area.Height);
            Changed = true;
            Next();
        }
        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) Close();
            else if (e.KeyCode == Keys.Space) { dragging = false; Next(); }
        }
    }

    class MainForm : Form, IAnfitrion
    {
        const int HotkeyId = 1, WM_HOTKEY = 0x0312;
        const uint MOD_NOREPEAT = 0x4000;
        readonly Settings settings = new Settings();
        readonly float scale;
        readonly Label viewerLabel, status, linkLabel;
        readonly CheckBox autoStart;
        readonly NotifyIcon tray;
        readonly Puente puente;
        bool startHidden, leaving, changingAutoStart;
        volatile string viewerName;
        volatile string hotkeyShared;
        volatile string titleShared;
        volatile string[] markedShared = new string[0];
        byte[] lastSent;
        string lastError;
        readonly ComboBox choice;
        readonly Button captureButton, cropButton, clearCropButton, undoButton, folderButton;
        readonly PictureBox preview;
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        readonly List<string> captures = new List<string>();
        readonly string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "SpeakDent");
        string hotkeyName = null;
        string chosenProcess = ""; // vacío = automático
        bool busy;

        int S(int v) { return (int)Math.Round(v * scale); }

        T Place<T>(T c, int x, int y, int w, int h) where T : Control
        {
            c.SetBounds(S(x), S(y), S(w), S(h));
            Controls.Add(c);
            return c;
        }

        public MainForm(bool hidden)
        {
            startHidden = hidden;
            using (var g = Graphics.FromHwnd(IntPtr.Zero)) scale = g.DpiX / 96f;
            Text = "Capturadora SpeakDent (prueba " + Puente.Version + ")";
            Font = new Font("Segoe UI", 9);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false; TopMost = true;
            BackColor = Color.White;
            ClientSize = new Size(S(320), S(446));
            StartPosition = FormStartPosition.Manual;
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Right - Width - S(16), wa.Bottom - Height - S(16));

            viewerLabel = Place(new Label { Font = new Font("Segoe UI", 10, FontStyle.Bold), AutoEllipsis = true }, 12, 8, 296, 22);
            choice = Place(new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, DropDownWidth = S(420) }, 12, 34, 296, 26);
            choice.Items.Add("Detectar el visor automáticamente");
            choice.SelectedIndex = 0;
            choice.DropDown += delegate { FillChoices(); };
            choice.SelectionChangeCommitted += delegate
            {
                var w = choice.SelectedItem as WindowInfo;
                chosenProcess = w == null ? "" : w.Process;
                RefreshStatus();
            };

            captureButton = Place(new Button { Font = new Font("Segoe UI", 12, FontStyle.Bold), BackColor = Color.FromArgb(94, 78, 160), ForeColor = Color.White, FlatStyle = FlatStyle.Flat }, 12, 68, 296, 46);
            captureButton.Click += delegate { TakeShot(puente == null ? null : puente.SesionActiva(), false); };
            cropButton = Place(new Button { Text = "Marcar vistas" }, 12, 120, 145, 28);
            cropButton.Click += delegate { DefineCrop(); };
            clearCropButton = Place(new Button { Text = "Borrar marcas" }, 163, 120, 145, 28);
            clearCropButton.Click += delegate
            {
                var w = Windows.Target(chosenProcess);
                if (w == null) { Say("No encuentro un visor abierto."); return; }
                if (settings.Marked(w.Process).Length == 0) { Say("No hay vistas marcadas en este visor."); return; }
                if (MessageBox.Show(this, "¿Desea borrar las vistas marcadas de " + (w.Viewer ?? w.Process) + "?", "Capturadora SpeakDent", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
                foreach (string id in Vistas.Ids) settings.SetRegion(w.Process, id, null);
                Say("Marcas borradas: se guardará la ventana completa.");
                RefreshStatus();
            };
            preview = Place(new PictureBox { SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.FromArgb(240, 239, 245) }, 12, 156, 296, 150);
            undoButton = Place(new Button { Text = "Deshacer última", Enabled = false }, 12, 312, 145, 28);
            undoButton.Click += delegate { Undo(); };
            folderButton = Place(new Button { Text = "Abrir carpeta" }, 163, 312, 145, 28);
            folderButton.Click += delegate
            {
                try { Directory.CreateDirectory(folder); Process.Start(folder); }
                catch (Exception ex) { Say("No pude abrir la carpeta: " + ex.Message); }
            };
            status = Place(new Label { ForeColor = Color.FromArgb(70, 68, 90) }, 12, 346, 296, 46);

            linkLabel = Place(new Label { ForeColor = Color.FromArgb(70, 68, 90) }, 12, 394, 296, 20);
            autoStart = Place(new CheckBox { Text = "Abrir sola al encender el computador" }, 12, 416, 296, 24);
            try { autoStart.Checked = Inicio.Activo(); } catch (Exception) { autoStart.Enabled = false; }
            autoStart.CheckedChanged += delegate { SetAutoStart(autoStart.Checked); };

            var menu = new ContextMenuStrip();
            menu.Items.Add("Abrir la capturadora", null, delegate { Reveal(); });
            menu.Items.Add("Salir", null, delegate { leaving = true; Close(); Application.ExitThread(); });
            tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Capturadora SpeakDent", ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += delegate { Reveal(); };

            puente = new Puente(this);
            OpenLink();

            timer.Interval = 1500;
            timer.Tick += delegate { if (!busy) { OpenLink(); RefreshStatus(); } };
            timer.Start();
        }

        // Justo después de cerrar la capturadora, Windows puede tardar en liberar la conexión: se reintenta.
        void OpenLink()
        {
            if (puente.Abierto) return;
            try { puente.Abrir(Puente.Puerto); lastError = null; }
            catch (Exception) { lastError = "Todavía no puedo conectar con SpeakDent; sigo intentando."; }
        }

        // Al iniciar con Windows queda solo el ícono junto al reloj, pero la ventana existe y escucha.
        protected override void SetVisibleCore(bool value)
        {
            if (startHidden && !IsHandleCreated)
            {
                startHidden = false;
                CreateHandle();
                Ready();
                value = false;
            }
            base.SetVisibleCore(value);
        }

        public void Reveal()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
            Win32.SetForegroundWindow(Handle);
        }

        // La X deja la capturadora junto al reloj; se cierra del todo desde ahí («Salir») o al apagar el equipo.
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!leaving && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                tray.ShowBalloonTip(4000, "Capturadora SpeakDent", "Sigue abierta junto al reloj. Para cerrarla: clic derecho y «Salir».", ToolTipIcon.Info);
                return;
            }
            base.OnFormClosing(e);
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            base.OnFormClosed(e);
            Application.ExitThread();
        }

        // Se llama al salir, aunque la ventana nunca se haya mostrado.
        public void Cleanup()
        {
            timer.Stop();
            puente.Dispose();
            tray.Visible = false;
            tray.Dispose();
        }

        void SetAutoStart(bool on)
        {
            if (changingAutoStart) return;
            try
            {
                if (on && !Inicio.RutaEstable(Application.ExecutablePath, Path.GetTempPath()))
                    throw new InvalidOperationException("descomprime primero la carpeta y ábrela desde ahí.");
                Inicio.Cambiar(on);
                Say(on ? "Se abrirá sola al encender el computador." : "Ya no se abrirá sola.");
            }
            catch (Exception ex)
            {
                changingAutoStart = true; autoStart.Checked = !on; changingAutoStart = false;
                Say("No se pudo cambiar: " + ex.Message);
            }
        }

        // Se pregunta una sola vez; la respuesta se puede cambiar con la casilla.
        void AskAutoStart()
        {
            if (settings.Get("inicio.preguntado") != "" || !autoStart.Enabled || autoStart.Checked) return;
            if (!Inicio.RutaEstable(Application.ExecutablePath, Path.GetTempPath())) return;
            bool yes = MessageBox.Show(this, "¿Abrir la capturadora sola cada vez que enciendas el computador?\n\nQuedará junto al reloj. No muevas ni borres su carpeta.",
                "Capturadora SpeakDent", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
            settings.Set("inicio.preguntado", "si");
            if (yes) autoStart.Checked = true;
        }

        // --- Lo que la ficha puede pedir (llega desde otro hilo) ---
        string IAnfitrion.Visor() { return viewerName; }
        string IAnfitrion.Tecla() { return hotkeyShared; }
        string IAnfitrion.Titulo() { return titleShared; }
        string[] IAnfitrion.Marcadas() { return markedShared; }
        Resultado IAnfitrion.Capturar(string sesion, bool todas)
        {
            try { return (Resultado)Invoke(new Func<Resultado>(delegate { return CaptureForRecord(sesion, todas); })); }
            catch (Exception ex) { return Resultado.Mal("La capturadora no pudo responder: " + ex.Message); }
        }
        Resultado CaptureForRecord(string sesion, bool todas)
        {
            IntPtr previous = Win32.GetForegroundWindow();
            string error = TakeShot(sesion, todas);
            if (previous != IntPtr.Zero) Focus(previous); // vuelve al navegador, donde está la ficha
            return error == null ? Resultado.Bien() : Resultado.Mal(error);
        }

        // La tecla se asocia a la ventana: si Windows la recrea, se vuelve a registrar.
        // Solo se reserva mientras hay un visor abierto, para no quitarle F8 a otros programas todo el día.
        void SetHotkey(bool wanted)
        {
            if (!IsHandleCreated) return;
            if (wanted && hotkeyName == null)
            {
                if (Win32.RegisterHotKey(Handle, HotkeyId, MOD_NOREPEAT, (uint)Keys.F8)) hotkeyName = "F8";
                else if (Win32.RegisterHotKey(Handle, HotkeyId, MOD_NOREPEAT, (uint)Keys.F9)) hotkeyName = "F9";
            }
            else if (!wanted && hotkeyName != null)
            {
                Win32.UnregisterHotKey(Handle, HotkeyId);
                hotkeyName = null;
            }
            hotkeyShared = hotkeyName;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            hotkeyName = null;
        }

        protected override void OnHandleDestroyed(EventArgs e)
        {
            if (hotkeyName != null) Win32.UnregisterHotKey(Handle, HotkeyId);
            hotkeyName = null;
            base.OnHandleDestroyed(e);
        }

        void Ready()
        {
            Say(lastError ?? "Abre tu visor y ubica el corte. Captura con F8 o desde la ficha del implante en SpeakDent.");
            RefreshStatus();
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Ready();
            AskAutoStart();
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HotkeyId) TakeShot(puente.SesionActiva(), false);
            base.WndProc(ref m);
        }

        void Say(string text) { status.Text = text; }

        void FillChoices()
        {
            choice.Items.Clear();
            choice.Items.Add("Detectar el visor automáticamente");
            foreach (var w in Windows.List()) choice.Items.Add(w);
        }

        void RefreshStatus()
        {
            var w = Windows.Target(chosenProcess);
            viewerName = w == null ? null : (w.Viewer ?? w.Process);
            titleShared = w == null ? null : w.Title;
            markedShared = w == null ? new string[0] : settings.Marked(w.Process);
            SetHotkey(w != null);
            captureButton.Text = hotkeyName == null ? "Capturar" : "Capturar  (" + hotkeyName + ")";
            linkLabel.Text = !puente.Abierto ? "○ Sin conexión con SpeakDent (reintentando)" : puente.SesionActiva() != null ? "● Conectada con una ficha de SpeakDent" : "○ Ninguna ficha de SpeakDent recibiendo";
            if (w == null) viewerLabel.Text = "○ No veo un visor abierto";
            else viewerLabel.Text = "● " + (w.Viewer ?? w.Process) + (markedShared.Length > 0 ? "  (" + markedShared.Length + (markedShared.Length == 1 ? " vista marcada)" : " vistas marcadas)") : "");
            viewerLabel.ForeColor = w == null ? Color.FromArgb(150, 90, 20) : Color.FromArgb(20, 120, 70);
        }

        // Windows no deja que un programa en segundo plano cambie de ventana: se intenta también
        // compartiendo la entrada con la ventana que está delante (el navegador, si la orden vino de la ficha).
        static bool IsFront(IntPtr h)
        {
            uint a, b; Win32.GetWindowThreadProcessId(h, out a); Win32.GetWindowThreadProcessId(Win32.GetForegroundWindow(), out b);
            return a == b;
        }
        static void Focus(IntPtr h)
        {
            Win32.SetForegroundWindow(h);
            if (IsFront(h)) return;
            uint pid;
            uint mine = Win32.GetCurrentThreadId(), front = Win32.GetWindowThreadProcessId(Win32.GetForegroundWindow(), out pid);
            if (front != 0 && front != mine && Win32.AttachThreadInput(mine, front, true))
            {
                try { Win32.BringWindowToTop(h); Win32.SetForegroundWindow(h); }
                finally { Win32.AttachThreadInput(mine, front, false); }
            }
            if (!IsFront(h)) Win32.SwitchToThisWindow(h, true);
        }

        // Trae el visor al frente y copia lo que se ve en su ventana. Devuelve null si no es seguro capturar.
        Bitmap Grab(WindowInfo w)
        {
            if (Win32.IsIconic(w.Handle)) { Win32.ShowWindow(w.Handle, 9); Thread.Sleep(500); }
            Focus(w.Handle);
            Application.DoEvents();
            Thread.Sleep(350);
            uint frontPid; Win32.GetWindowThreadProcessId(Win32.GetForegroundWindow(), out frontPid);
            if (frontPid != w.Pid) { Fail("No pude traer el visor al frente. Haz clic en él y presiona la tecla."); return null; }

            Win32.RECT r;
            bool ok = false;
            try { ok = Win32.DwmGetWindowAttribute(w.Handle, 9, out r, Marshal.SizeOf(typeof(Win32.RECT))) == 0; }
            catch (Exception) { r = new Win32.RECT(); }
            if (!ok || r.Right <= r.Left) Win32.GetWindowRect(w.Handle, out r);
            Rectangle area = Rectangle.Intersect(Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom), SystemInformation.VirtualScreen);
            if (area.Width < 50 || area.Height < 50) { Fail("La ventana del visor está fuera de la pantalla."); return null; }

            var bmp = new Bitmap(area.Width, area.Height, PixelFormat.Format24bppRgb);
            using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(area.Location, Point.Empty, area.Size);
            return bmp;
        }

        void Fail(string text) { lastError = text; Say(text); }

        // sesion: ficha que debe recibir la imagen (null = solo guardar). todas: una imagen por cada vista marcada.
        // Devuelve null si salió bien.
        string TakeShot(string sesion, bool todas)
        {
            if (busy) return "La capturadora está ocupada. Intenta de nuevo.";
            busy = true;
            lastError = null;
            try
            {
                var w = Windows.Target(chosenProcess);
                if (w == null) { Fail("No veo un visor abierto. Ábrelo o elige su ventana en la lista."); return lastError; }
                string[] marked = settings.Marked(w.Process);
                if (todas && marked.Length == 0) { Fail("Primero marca las vistas: en la capturadora, «Marcar vistas»."); return lastError; }
                Opacity = 0; // la capturadora no debe salir en la imagen
                Bitmap full = Grab(w);
                if (full == null) return lastError ?? "No pude capturar.";
                using (full)
                {
                    string chosen; bool wholeWindow;
                    puente.Preferencia(sesion, out chosen, out wholeWindow);
                    string title = w.Title; // el de la ventana que se está capturando
                    var views = todas ? marked : new[] { chosen };
                    int sent = 0, cropped = 0;
                    bool copied = false;
                    foreach (string view in views)
                    {
                        RectangleF? c = view == null || (wholeWindow && !todas) ? null : settings.GetRegion(w.Process, view);
                        Bitmap result = full;
                        if (c != null)
                        {
                            Rectangle rect = Settings.Pixels(c.Value, full.Size);
                            if (rect.Width > 0 && rect.Height > 0) { result = full.Clone(rect, full.PixelFormat); cropped++; }
                        }
                        string warning = result != full && settings.SizeChanged(w.Process, full.Size)
                            ? "El visor cambió de tamaño desde que marcaste las vistas: revisa el recorte o vuelve a marcarlas." : null;
                        try
                        {
                            copied = Save(result);
                            if (sesion != null)
                                using (var png = new MemoryStream())
                                {
                                    result.Save(png, ImageFormat.Png);
                                    byte[] data = png.ToArray();
                                    if (puente.Entregar(sesion, data, w.Viewer ?? w.Process, view, title, warning)) { lastSent = data; sent++; }
                                }
                        }
                        finally { if (result != full) result.Dispose(); }
                    }
                    System.Media.SystemSounds.Asterisk.Play();
                    string what = todas ? views.Length + (views.Length == 1 ? " vista" : " vistas") : cropped > 0 ? "vista " + Vistas.Nombre(views[0]) : "ventana completa";
                    Say("Guardada (" + what + ") desde " + (w.Viewer ?? w.Process) + (sent > 0 ? " para la ficha abierta." : copied ? " y copiada para pegar." : "."));
                }
                return null;
            }
            catch (Exception ex) { Fail("No pude capturar: " + ex.Message); return lastError; }
            finally { Opacity = 1; busy = false; }
        }

        // Guarda en la carpeta y copia al portapapeles. Devuelve true si quedó copiada.
        bool Save(Bitmap bmp)
        {
            Directory.CreateDirectory(folder);
            string file = Path.Combine(folder, "SpeakDent_" + DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff", CultureInfo.InvariantCulture) + ".png");
            for (int n = 2; File.Exists(file); n++) file = Path.Combine(folder, Path.GetFileNameWithoutExtension(file) + "_" + n + ".png");
            bmp.Save(file, ImageFormat.Png);
            captures.Add(file);
            lastSent = null;
            bool copied = true;
            try { Clipboard.SetImage(bmp); } catch (Exception) { copied = false; }
            ShowPreview(file);
            return copied;
        }

        void ShowPreview(string file)
        {
            var old = preview.Image;
            preview.Image = null;
            if (old != null) old.Dispose();
            if (file != null && File.Exists(file))
                using (var source = Image.FromFile(file)) preview.Image = new Bitmap(source);
            undoButton.Enabled = captures.Count > 0;
        }

        void Undo()
        {
            if (captures.Count == 0) return;
            if (MessageBox.Show(this, "¿Borrar la última captura?", "Deshacer", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            string file = captures[captures.Count - 1];
            try
            {
                File.Delete(file);
                if (lastSent != null) puente.Retirar(lastSent);
                captures.RemoveAt(captures.Count - 1);
                try { Clipboard.Clear(); } catch (Exception) { }
                ShowPreview(captures.Count > 0 ? captures[captures.Count - 1] : null);
                Say(lastSent != null ? "Captura borrada. Si ya entró a la ficha, quítala también ahí." : "Captura borrada.");
                lastSent = null;
            }
            catch (Exception ex) { Say("No pude borrarla: " + ex.Message); }
        }

        void DefineCrop()
        {
            if (busy) return;
            busy = true;
            try
            {
                var w = Windows.Target(chosenProcess);
                if (w == null) { Say("Primero abre tu visor o elige su ventana."); return; }
                Opacity = 0;
                Bitmap full = Grab(w);
                if (full == null) return;
                var current = new RectangleF?[Vistas.Ids.Length];
                bool moved = settings.SizeChanged(w.Process, full.Size);
                for (int i = 0; i < current.Length; i++) current[i] = moved ? null : settings.GetRegion(w.Process, Vistas.Ids[i]);
                using (full)
                using (var crop = new CropForm(full, current))
                {
                    crop.Shown += delegate { crop.Activate(); Win32.SetForegroundWindow(crop.Handle); };
                    crop.ShowDialog();
                    if (crop.Changed)
                    {
                        for (int i = 0; i < current.Length; i++) settings.SetRegion(w.Process, Vistas.Ids[i], crop.Regions[i]);
                        settings.SetMarkedSize(w.Process, full.Size);
                        Say("Vistas recordadas para " + (w.Viewer ?? w.Process) + ".");
                    }
                    else Say("Marcas sin cambios.");
                }
            }
            catch (Exception ex) { Say("No pude marcar las vistas: " + ex.Message); }
            finally { Opacity = 1; busy = false; RefreshStatus(); }
        }
    }

    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            try { Win32.SetProcessDPIAware(); } catch (Exception) { }
            bool hidden = Array.IndexOf(args, Inicio.Silencio) >= 0;
            bool first, noSignal;
            using (var mutex = new Mutex(true, "SpeakDent.Capturadora", out first))
            using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, "SpeakDent.Capturadora.Mostrar", out noSignal))
            {
                if (!first)
                {
                    // Si la señal no existía, la que está abierta es la versión anterior: no sabe mostrarse.
                    if (noSignal) MessageBox.Show("Tienes abierta la capturadora anterior. Ciérrala y vuelve a abrir esta.", "SpeakDent");
                    else if (!hidden) show.Set(); // abre la ventana de la que ya está funcionando
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                var form = new MainForm(hidden);
                // Si la carpeta cambió de lugar, el inicio automático apunta al programa que se está usando.
                try { if (Inicio.Activo() && Inicio.RutaEstable(Application.ExecutablePath, Path.GetTempPath())) Inicio.Cambiar(true); }
                catch (Exception) { }
                var wait = ThreadPool.RegisterWaitForSingleObject(show, delegate
                {
                    try { if (form.IsHandleCreated) form.BeginInvoke(new MethodInvoker(form.Reveal)); }
                    catch (Exception) { }
                }, null, -1, false);
                Application.Run(form);
                wait.Unregister(null);
                form.Cleanup();
            }
        }
    }
}
