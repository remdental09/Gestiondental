// Solo para pruebas: ventana que imita a un visor, con zonas de color conocidas.
using System;
using System.Drawing;
using System.Windows.Forms;
class FakeViewer : Form
{
    FakeViewer() { Text = "Blue Sky Plan - prueba"; ClientSize = new Size(640, 400); StartPosition = FormStartPosition.Manual; Location = new Point(40, 40); BackColor = Color.Black; }
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.FillRectangle(Brushes.Red, 0, 0, ClientSize.Width / 2, ClientSize.Height);
        e.Graphics.FillRectangle(Brushes.Lime, ClientSize.Width / 2, 0, ClientSize.Width / 2, ClientSize.Height);
    }
    [STAThread] static void Main() { Application.Run(new FakeViewer()); }
}
