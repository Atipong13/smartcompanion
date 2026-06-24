from faster_whisper import WhisperModel
import sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

model = WhisperModel(
    "small",
    device="cpu",
    compute_type="int8"
)

file_path = sys.argv[1]

segments, info = model.transcribe(
    file_path,
    language="th",
    beam_size=5,
    vad_filter=True
)

text = " ".join([s.text for s in segments])

print(text.strip())