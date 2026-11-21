# Shows a real Windows toast, so Miku's PC notifications can be tried by hand
# (pc_notifications.rs reads it back from Windows' notification list).
# Dev-only. Usage: .\dev\send-toast.ps1 "Title" "Body"
# It comes from PowerShell's own app id, so Miku names it "Powershell".
param([string]$Title = "Rapat sprint dipindah", [string]$Body = "Dimas: jadi jam 14.00 ya, ruang Sakura")

[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

$esc = { param($s) [System.Security.SecurityElement]::Escape($s) }
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template=`"ToastGeneric`"><text>$(& $esc $Title)</text><text>$(& $esc $Body)</text></binding></visual></toast>")
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
