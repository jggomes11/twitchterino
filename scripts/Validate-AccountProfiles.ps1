[CmdletBinding()]
param([string]$Executable, [string]$ReportPath)
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Native Windows is required.' }
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
if (-not $Executable) { $Executable = 'release-output/portable/app/Twitchterino.exe' }
if (-not $ReportPath) { $ReportPath = 'release-output/profile-validation.json' }
if (-not [IO.Path]::IsPathRooted($Executable)) { $Executable = Join-Path $RepositoryRoot $Executable }
if (-not [IO.Path]::IsPathRooted($ReportPath)) { $ReportPath = Join-Path $RepositoryRoot $ReportPath }
$ControllerLog = [IO.Path]::ChangeExtension($ReportPath, '.controller.log')
$DesktopReport = [IO.Path]::ChangeExtension($ReportPath, '.desktop.json')
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
$NodeBinary = (Get-Command node -ErrorAction Stop).Source
$PowerShellBinary = (Get-Process -Id $PID).Path

# Native GUI processes share a desktop heap. Give this fixture its own desktop;
# keep the actual application, launch arguments and lifecycle assertions intact.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class AccountProfileDesktop {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct StartupInfo {
    public int cb; public string reserved, desktop, title;
    public int x,y,xSize,ySize,xChars,yChars,fill,flags;
    public short show, reservedSize;
    public IntPtr reservedData,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateDesktopExW(string name,IntPtr device,IntPtr mode,uint flags,uint access,IntPtr security,uint heap,IntPtr reserved);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint tid);
  [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern bool GetUserObjectInformationW(IntPtr handle,int index,IntPtr buffer,uint length,out uint needed);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string directory,ref StartupInfo startup,out ProcessInfo info);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  public static string Name(IntPtr handle) {
    uint size; GetUserObjectInformationW(handle,2,IntPtr.Zero,0,out size);
    if(size==0)return "unknown";
    IntPtr buffer=Marshal.AllocHGlobal((int)size);
    try { return GetUserObjectInformationW(handle,2,buffer,size,out size)?Marshal.PtrToStringUni(buffer):"unknown"; }
    finally { Marshal.FreeHGlobal(buffer); }
  }
  public static int HeapKB(IntPtr desktop) {
    uint needed; IntPtr buffer=Marshal.AllocHGlobal(4);
    try { return GetUserObjectInformationW(desktop,5,buffer,4,out needed)?Marshal.ReadInt32(buffer):-1; }
    finally { Marshal.FreeHGlobal(buffer); }
  }
  public static IntPtr Create(string name) {
    IntPtr desktop=CreateDesktopExW(name,IntPtr.Zero,IntPtr.Zero,0,0x10000000,IntPtr.Zero,16384,IntPtr.Zero);
    if(desktop==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
    return desktop;
  }
  public static ProcessInfo Launch(string application,string command,string desktop,string directory) {
    StartupInfo startup=new StartupInfo(); startup.cb=Marshal.SizeOf(typeof(StartupInfo)); startup.desktop=desktop;
    ProcessInfo info;
    if(!CreateProcessW(application,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x08000000,IntPtr.Zero,directory,ref startup,out info))
      throw new Win32Exception(Marshal.GetLastWin32Error());
    return info;
  }
}
'@
function Quote-Literal([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$CurrentDesktop = [AccountProfileDesktop]::GetThreadDesktop([AccountProfileDesktop]::GetCurrentThreadId())
$DesktopName = 'TwitchterinoValidation-' + $PID
$Details = [ordered]@{
    session = (Get-Process -Id $PID).SessionId
    interactive = [Environment]::UserInteractive
    station = [AccountProfileDesktop]::Name([AccountProfileDesktop]::GetProcessWindowStation())
    originalDesktop = [AccountProfileDesktop]::Name($CurrentDesktop)
    originalHeapKB = [AccountProfileDesktop]::HeapKB($CurrentDesktop)
    isolatedHeapKB = $null
    controllerExit = $null
}
$DesktopHandle = [IntPtr]::Zero
$Controller = $null
$ControllerExit = 1
try {
    $DesktopHandle = [AccountProfileDesktop]::Create($DesktopName)
    $Details.isolatedHeapKB = [AccountProfileDesktop]::HeapKB($DesktopHandle)
    Write-Output ($Details | ConvertTo-Json -Compress)
    $FixtureScript = Join-Path $PSScriptRoot 'validate-profiles.cjs'
    $ChildScript = '$ErrorActionPreference = ''Stop''; try { & ' + (Quote-Literal $NodeBinary) + ' ' + (Quote-Literal $FixtureScript) + ' ' + (Quote-Literal $Executable) + ' ' + (Quote-Literal $ReportPath) + ' *> ' + (Quote-Literal $ControllerLog) + '; exit $LASTEXITCODE } catch { $_ | Out-String | Add-Content -LiteralPath ' + (Quote-Literal $ControllerLog) + '; exit 1 }'
    $EncodedScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ChildScript))
    $CommandLine = '"' + $PowerShellBinary + '" -NoLogo -NoProfile -NonInteractive -EncodedCommand ' + $EncodedScript
    $Controller = [AccountProfileDesktop]::Launch($PowerShellBinary, $CommandLine, $DesktopName, $RepositoryRoot)
    if ([AccountProfileDesktop]::WaitForSingleObject($Controller.process, 300000) -ne 0) {
        & taskkill /PID $Controller.pid /T /F 2>&1 | Out-Null
        throw 'Isolated desktop validation exceeded its deadline.'
    }
    [uint32]$NativeExit = 1
    if (-not [AccountProfileDesktop]::GetExitCodeProcess($Controller.process, [ref]$NativeExit)) { throw 'Could not read validation exit code.' }
    $ControllerExit = [int]$NativeExit
    $Details.controllerExit = $ControllerExit
} finally {
    if (Test-Path -LiteralPath $ControllerLog) { Get-Content -LiteralPath $ControllerLog }
    $Details | ConvertTo-Json | Set-Content -LiteralPath $DesktopReport -Encoding utf8
    if ($Controller) { [void][AccountProfileDesktop]::CloseHandle($Controller.thread); [void][AccountProfileDesktop]::CloseHandle($Controller.process) }
    if ($DesktopHandle -ne [IntPtr]::Zero) { [void][AccountProfileDesktop]::CloseDesktop($DesktopHandle) }
}
exit $ControllerExit
