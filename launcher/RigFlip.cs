// RigFlip launcher for Windows.
// Opens the RigFlip website in its own app window using Microsoft Edge, which is built into Windows 10 and 11.
// For safety it can only ever open this one address: it ignores anything passed to it, reads no files,
// downloads nothing, needs no admin rights and changes no settings.
// Build: C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /target:winexe /win32icon:RigFlip.ico /out:RigFlip.exe RigFlip.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("RigFlip")]
[assembly: AssemblyProduct("RigFlip")]
[assembly: AssemblyDescription("Opens the RigFlip animation maker in its own window.")]
[assembly: AssemblyCopyright("Copyright (c) 2026 animeyeeter123. MIT licence.")]
[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]

static class Program
{
    const string AppUrl = "https://animeyeeter123.github.io/r6-flipbook/";

    [STAThread]
    static void Main()
    {
        string edge = FindEdge();
        if (edge == null)
        {
            MessageBox.Show("RigFlip needs Microsoft Edge, which comes with Windows.\n\nYou can also open it in any browser:\n" + AppUrl,
                            "RigFlip", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        var start = new ProcessStartInfo(edge, "--app=" + AppUrl);
        start.UseShellExecute = false;
        Process.Start(start);
    }

    // Edge's own install location, as registered by Windows; falls back to the standard folders.
    static string FindEdge()
    {
        foreach (RegistryKey root in new[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            using (RegistryKey key = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
            {
                string path = key == null ? null : key.GetValue("") as string;
                if (IsEdge(path)) return path;
            }
        }
        foreach (Environment.SpecialFolder folder in new[] { Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.ProgramFiles })
        {
            string path = Path.Combine(Environment.GetFolderPath(folder), @"Microsoft\Edge\Application\msedge.exe");
            if (IsEdge(path)) return path;
        }
        return null;
    }

    static bool IsEdge(string path)
    {
        return !string.IsNullOrEmpty(path) && File.Exists(path)
            && string.Equals(Path.GetFileName(path), "msedge.exe", StringComparison.OrdinalIgnoreCase);
    }
}
