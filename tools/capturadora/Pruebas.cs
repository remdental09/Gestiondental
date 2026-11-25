// Pruebas de la lógica que no depende de Windows.
using System;
using System.Drawing;
using System.Reflection;
using SpeakDent;
static class Pruebas
{
    static int fails, total;
    static void Check(string name, bool ok) { total++; if (!ok) { fails++; Console.WriteLine("FALLA: " + name); } }
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
        var asm = Assembly.LoadFrom(args[0]);
        foreach (var r in asm.GetReferencedAssemblies()) Console.WriteLine("usa " + r.Name + " " + r.Version);
        Console.WriteLine((total - fails) + "/" + total + " pruebas correctas");
        return fails == 0 ? 0 : 1;
    }
}
