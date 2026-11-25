// Capturadora SpeakDent — versión de prueba para Windows.
// Captura la ventana del visor DICOM cuando el usuario lo pide (F8 o botón).
// No usa internet: guarda en Imágenes\SpeakDent y copia al portapapeles.
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

[assembly: AssemblyTitle("Capturadora SpeakDent")]
[assembly: AssemblyProduct("SpeakDent")]
[assembly: AssemblyDescription("Captura imágenes del visor DICOM a pedido del usuario. Versión de prueba.")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

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

        // Un programa reconocido pesa más que una ventana que solo menciona el visor en su título.
        public static bool Better(WindowInfo a, WindowInfo b)
        {
            if (b == null) return true;
            if (a.ByProcess != b.ByProcess) return a.ByProcess;
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
                if (w.Handle == front) return w;
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
        // El recorte se guarda como fracciones de la ventana, así sirve aunque cambie su tamaño.
        public RectangleF? GetCrop(string process)
        {
            string[] p = Get("recorte." + process).Split(';');
            if (p.Length != 4) return null;
            var n = new float[4];
            for (int i = 0; i < 4; i++)
                if (!float.TryParse(p[i], NumberStyles.Float, CultureInfo.InvariantCulture, out n[i])) return null;
            if (n[2] <= 0 || n[3] <= 0) return null;
            return new RectangleF(n[0], n[1], n[2], n[3]);
        }
        public void SetCrop(string process, RectangleF? c)
        {
            Set("recorte." + process, c == null ? "" : string.Format(CultureInfo.InvariantCulture, "{0};{1};{2};{3}",
                c.Value.X, c.Value.Y, c.Value.Width, c.Value.Height));
        }
    }

    class CropForm : Form
    {
        readonly Bitmap image;
        Point start; Rectangle selection; bool dragging;
        public RectangleF? Result;

        public CropForm(Bitmap bmp)
        {
            image = bmp;
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
            e.Graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
            e.Graphics.DrawImage(image, ImageArea());
            if (selection.Width > 0)
                using (var pen = new Pen(Color.Yellow, 3)) e.Graphics.DrawRectangle(pen, selection);
            using (var f = new Font("Segoe UI", 13))
            {
                const string msg = "Arrastra sobre la zona que quieres guardar siempre.  Esc cancela.";
                var size = e.Graphics.MeasureString(msg, f);
                e.Graphics.FillRectangle(Brushes.Black, 10, 10, size.Width + 12, size.Height + 8);
                e.Graphics.DrawString(msg, f, Brushes.Yellow, 16, 14);
            }
        }
        protected override void OnMouseDown(MouseEventArgs e) { start = e.Location; dragging = true; selection = Rectangle.Empty; Invalidate(); }
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
            Result = new RectangleF((s.X - area.X) / (float)area.Width, (s.Y - area.Y) / (float)area.Height,
                s.Width / (float)area.Width, s.Height / (float)area.Height);
            DialogResult = DialogResult.OK;
            Close();
        }
        protected override void OnKeyDown(KeyEventArgs e) { if (e.KeyCode == Keys.Escape) Close(); }
    }

    class MainForm : Form
    {
        const int HotkeyId = 1, WM_HOTKEY = 0x0312;
        const uint MOD_NOREPEAT = 0x4000;
        readonly Settings settings = new Settings();
        readonly float scale;
        readonly Label viewerLabel, status;
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

        public MainForm()
        {
            using (var g = Graphics.FromHwnd(IntPtr.Zero)) scale = g.DpiX / 96f;
            Text = "Capturadora SpeakDent (prueba)";
            Font = new Font("Segoe UI", 9);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false; TopMost = true;
            BackColor = Color.White;
            ClientSize = new Size(S(320), S(398));
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
            captureButton.Click += delegate { TakeShot(); };
            cropButton = Place(new Button { Text = "Marcar recorte" }, 12, 120, 145, 28);
            cropButton.Click += delegate { DefineCrop(); };
            clearCropButton = Place(new Button { Text = "Ventana completa" }, 163, 120, 145, 28);
            clearCropButton.Click += delegate
            {
                var w = Windows.Target(chosenProcess);
                if (w == null) { Say("No encuentro un visor abierto."); return; }
                settings.SetCrop(w.Process, null);
                Say("Se guardará la ventana completa.");
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

            timer.Interval = 1500;
            timer.Tick += delegate { if (!busy) RefreshStatus(); };
            timer.Start();
        }

        // La tecla se asocia a la ventana: si Windows la recrea, se vuelve a registrar.
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            hotkeyName = null;
            if (Win32.RegisterHotKey(Handle, HotkeyId, MOD_NOREPEAT, (uint)Keys.F8)) hotkeyName = "F8";
            else if (Win32.RegisterHotKey(Handle, HotkeyId, MOD_NOREPEAT, (uint)Keys.F9)) hotkeyName = "F9";
        }

        protected override void OnHandleDestroyed(EventArgs e)
        {
            if (hotkeyName != null) Win32.UnregisterHotKey(Handle, HotkeyId);
            base.OnHandleDestroyed(e);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            captureButton.Text = hotkeyName == null ? "Capturar" : "Capturar  (" + hotkeyName + ")";
            Say(hotkeyName == null ? "F8 y F9 están ocupadas por otro programa: usa el botón."
                : "Abre tu visor, ubica el corte y presiona " + hotkeyName + ". Esta prueba no usa internet.");
            RefreshStatus();
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HotkeyId) TakeShot();
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
            if (w == null) viewerLabel.Text = "○ No veo un visor abierto";
            else viewerLabel.Text = "● " + (w.Viewer ?? w.Process) + (settings.GetCrop(w.Process) != null ? "  (con recorte)" : "");
            viewerLabel.ForeColor = w == null ? Color.FromArgb(150, 90, 20) : Color.FromArgb(20, 120, 70);
        }

        // Trae el visor al frente y copia lo que se ve en su ventana. Devuelve null si no es seguro capturar.
        Bitmap Grab(WindowInfo w)
        {
            if (Win32.IsIconic(w.Handle)) { Win32.ShowWindow(w.Handle, 9); Thread.Sleep(500); }
            Win32.SetForegroundWindow(w.Handle);
            Application.DoEvents();
            Thread.Sleep(350);
            uint frontPid; Win32.GetWindowThreadProcessId(Win32.GetForegroundWindow(), out frontPid);
            if (frontPid != w.Pid) { Say("No pude traer el visor al frente. Haz clic en él y presiona la tecla."); return null; }

            Win32.RECT r;
            bool ok = false;
            try { ok = Win32.DwmGetWindowAttribute(w.Handle, 9, out r, Marshal.SizeOf(typeof(Win32.RECT))) == 0; }
            catch (Exception) { r = new Win32.RECT(); }
            if (!ok || r.Right <= r.Left) Win32.GetWindowRect(w.Handle, out r);
            Rectangle area = Rectangle.Intersect(Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom), SystemInformation.VirtualScreen);
            if (area.Width < 50 || area.Height < 50) { Say("La ventana del visor está fuera de la pantalla."); return null; }

            var bmp = new Bitmap(area.Width, area.Height, PixelFormat.Format24bppRgb);
            using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(area.Location, Point.Empty, area.Size);
            return bmp;
        }

        void TakeShot()
        {
            if (busy) return;
            busy = true;
            try
            {
                var w = Windows.Target(chosenProcess);
                if (w == null) { Say("No veo un visor abierto. Ábrelo o elige su ventana en la lista."); return; }
                Opacity = 0; // la capturadora no debe salir en la imagen
                Bitmap full = Grab(w);
                if (full == null) return;
                using (full)
                {
                    Bitmap result = full;
                    RectangleF? c = settings.GetCrop(w.Process);
                    if (c != null)
                    {
                        var rect = Rectangle.Intersect(new Rectangle(0, 0, full.Width, full.Height), new Rectangle(
                            (int)Math.Round(c.Value.X * full.Width), (int)Math.Round(c.Value.Y * full.Height),
                            (int)Math.Round(c.Value.Width * full.Width), (int)Math.Round(c.Value.Height * full.Height)));
                        if (rect.Width > 0 && rect.Height > 0) result = full.Clone(rect, full.PixelFormat);
                    }
                    try { Save(result, w); }
                    finally { if (result != full) result.Dispose(); }
                }
            }
            catch (Exception ex) { Say("No pude capturar: " + ex.Message); }
            finally { Opacity = 1; busy = false; }
        }

        void Save(Bitmap bmp, WindowInfo w)
        {
            Directory.CreateDirectory(folder);
            string file = Path.Combine(folder, "SpeakDent_" + DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff", CultureInfo.InvariantCulture) + ".png");
            bmp.Save(file, ImageFormat.Png);
            captures.Add(file);
            bool copied = true;
            try { Clipboard.SetImage(bmp); } catch (Exception) { copied = false; }
            ShowPreview(file);
            System.Media.SystemSounds.Asterisk.Play();
            Say("Guardada desde " + (w.Viewer ?? w.Process) + (copied ? " y copiada para pegar." : "."));
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
                captures.RemoveAt(captures.Count - 1);
                try { Clipboard.Clear(); } catch (Exception) { }
                ShowPreview(captures.Count > 0 ? captures[captures.Count - 1] : null);
                Say("Captura borrada.");
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
                using (full)
                using (var crop = new CropForm(full))
                {
                    crop.Shown += delegate { crop.Activate(); Win32.SetForegroundWindow(crop.Handle); };
                    if (crop.ShowDialog() == DialogResult.OK)
                    {
                        settings.SetCrop(w.Process, crop.Result);
                        Say("Recorte recordado para " + (w.Viewer ?? w.Process) + ".");
                    }
                    else Say("Recorte sin cambios.");
                }
            }
            catch (Exception ex) { Say("No pude marcar el recorte: " + ex.Message); }
            finally { Opacity = 1; busy = false; RefreshStatus(); }
        }
    }

    static class Program
    {
        [STAThread]
        static void Main()
        {
            try { Win32.SetProcessDPIAware(); } catch (Exception) { }
            bool first;
            using (var mutex = new Mutex(true, "SpeakDent.Capturadora", out first))
            {
                if (!first)
                {
                    MessageBox.Show("La capturadora ya está abierta.", "SpeakDent");
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
        }
    }
}
