$ErrorActionPreference = 'Stop'
$spokenText = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($spokenText)) { exit 1 }
Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$memory = [System.IO.MemoryStream]::new()
try {
    $voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'en-US' } | Select-Object -First 1
    if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }
    $synth.SetOutputToWaveStream($memory)
    $synth.Speak($spokenText)
    [Console]::Out.Write([Convert]::ToBase64String($memory.ToArray()))
} finally {
    $synth.Dispose()
    $memory.Dispose()
}
