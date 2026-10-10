param([string]$OutputDirectory = '.codex-audit-audio/fixtures')
$ErrorActionPreference = 'Stop'
# Local synthetic speech only. No user recording or external API.
Add-Type -AssemblyName System.Speech
$taskAudioDir = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
New-Item -ItemType Directory -Path $taskAudioDir -Force | Out-Null
$taskSpeaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$taskSamples = @(
  @{file='daily.wav';synthetic=$true;expected='Amanhã quero revisar o plano do projeto e criar uma nota com os próximos passos.'},
  @{file='engineering.wav';synthetic=$true;expected='O Arduino Uno usa um cabo USB tipo A para tipo B. Vamos comparar um ESP32 com dois servomotores MG90S.'},
  @{file='review.wav';synthetic=$true;expected='Não aplique a alteração ainda. Pesquise as referências e me mostre três opções antes de continuar.'}
)
try {
  $taskSpeaker.SelectVoice('Microsoft Maria Desktop')
  foreach($taskSample in $taskSamples) {
    $taskSpeaker.SetOutputToWaveFile((Join-Path $taskAudioDir $taskSample.file))
    $taskSpeaker.Speak($taskSample.expected)
  }
} finally { $taskSpeaker.Dispose() }
$taskSamples | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $taskAudioDir 'manifest.json') -Encoding utf8
Get-ChildItem -LiteralPath $taskAudioDir | Select-Object Name,Length
