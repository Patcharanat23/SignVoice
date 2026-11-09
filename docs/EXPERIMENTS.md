# Experiments

All numbers were measured on our machines. Most hyperparameters are standard defaults; we did not run a full search. Unless noted, tests ran on Windows with an RTX 3060 Laptop GPU (6 GB) and 16 GB RAM.

## Data

| Dataset | Used | Signers | Licence |
|---|---|---:|---|
| [TSL-51](https://huggingface.co/datasets/Namonpas/thai-sign-language-tsl51) | 51 signs + null, 1,155 source clips, plus 547 clips from a third signer | 3 | CC BY-NC-SA 4.0 |
| [TSL-ONE](https://tsl-one.github.io/) | 184 signs (family, numbers, fingerspelling, vowels), 4,152 clips | 29 | Non-commercial, request form |

Only keypoints are used, never video. TSL-ONE was added because the main problem was accuracy on new people, and it has ten times as many signers. Face points are dropped because TSL-ONE has none; otherwise the model could learn "no face = TSL-ONE word". The app uses 146 of the 236 classes (`ml/vocab_exclude.json`), leaving out places, countries and sports.

The 32-frame length sits between the 10th percentile (23) and the median (42) of 1,124 clips recorded from the live camera.

## Evaluation protocol

The test set is split **by signer**, not by clip: five TSL-ONE signers and the third TSL-51 signer are never seen in training. Splitting by clip would let the model recognise a person's hands and overstate accuracy. Seed 11 makes runs repeatable.

## Recognition

| Test | Top-1 | Top-5 |
|---|---:|---:|
| 5 held-out TSL-ONE signers (666 clips, 236 classes) | **86.2%** | 95.3% |
| Held-out TSL-51 signer (547 clips) | 78.8% | 91.2% |
| Same, restricted to the 146 words in use | 87.4% / 80.6% | |

Training data:

| Trained on | Tested on | Top-1 |
|---|---|---:|
| TSL-51 only | TSL-51 signer | 77.1% |
| TSL-51 + TSL-ONE | TSL-51 signer | 78.8% |
| TSL-51 + TSL-ONE | TSL-ONE signers | 86.2% |

The vocabulary grew 4.5 times and accuracy still went up, because the model saw 32 signers instead of 3. Held-out accuracy levels off around epoch 25 to 30 (84.2% at 20, 86.6% at 25, 86.2% at 40), so 40 epochs is enough.

Pairs that remain confused are genuinely similar signs: น้า / อา, ปู่ / ทวดชาย, ธ / ฮ, อะไร / ที่ไหน.

## Landmark extractor

Same 104 browser clips, same machine.

| Extractor | Top-1 | FPS |
|---|---:|---:|
| MediaPipe Holistic | 78.8% | 6–9 |
| **Hand + Pose on GPU** | **80.8%** | 14–19 |

Holistic also processes the face and lost fingers during fast movement.

## Confidence threshold

Held-out clips, including 23 "no sign" clips.

| Threshold | 0 | 0.20 | 0.30 | **0.35** | 0.40 | 0.50 | 0.70 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Precision of accepted words (%) | 84.9 | 88.1 | 89.8 | **90.8** | 91.5 | 93.3 | 95.0 |
| Real words kept (%) | 100 | 95.0 | 90.7 | **88.8** | 86.9 | 82.7 | 73.5 |

At 0.35, "no sign" clips added as words drop from 18 of 23 to 2 of 23. Above that, more real words are lost than errors are removed.

## Left-handed signers

| Hand | Before | After mirrored training |
|---|---:|---:|
| Right | 86.2% | 85.1% |
| Left | 20.1% | 81.4% |

## Sentence ordering (LLM)

41 cases in Thai Sign Language word order, 13 of them with structures that do not appear in the prompt. Same system prompt as the app, temperature 0.1, `num_predict` 120, scored after `repairThaiSentence()`. A case passes only if every signed word is kept, the key words are in the reference order, and no other vocabulary word is added. RTX 5050 Laptop GPU (8 GB), Ollama in Docker.

| Model | Pass | Unseen structures | Median latency | Tokens/s | VRAM |
|---|---:|---:|---:|---:|---:|
| No LLM (signs joined in order) | 26.8% | 53.8% | 0 ms | – | – |
| Llama 3.2 3B | 68.3% | 38.5% | 121 ms | 100.4 | 2.56 GB |
| Gemma 3 4B | 70.7% | 84.6% | 336 ms | 77.0 | 2.88 GB |
| **Qwen3 4B Instruct** | **92.7%** | **92.3%** | 157 ms | 74.9 | 3.18 GB |

Typical errors: Llama replaced the subject with "ฉัน" (6 times); Gemma put "ชอบ" at the end of the sentence (4 times). Qwen3 is 22 points ahead of the next model for 36 ms more per sentence.

## Speech

| System | Runs on | Time | Notes |
|---|---|---:|---|
| PyThaiTTS | local | ~7 s (short word) | Reloads its model on each call; unclear voice |
| ThonburianTTS | local GPU | 2–5 s | Offline fallback |
| **ElevenLabs** | cloud | 2.2 s | Clearest voice; repeated sentences 0.007 s from cache |

## Fine-tuning on the user's own signs

Latest run: 22 words, 217 training samples, 44 held out. Held-out accuracy 11.4% before, 100% after (also 100% on the mirrored samples). The held-out samples were recorded in the same room and light as the training ones, so expect lower numbers elsewhere.

## Raw results

`docs/tsl-combined-report.json`, `docs/tsl51-report.json`, `docs/tsl51-browser-eval.json`, `docs/llm-eval.json`, `docs/mirror-experiment.json`, `docs/storage-benchmark.json`.
