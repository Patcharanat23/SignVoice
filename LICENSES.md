# Third-party licences

SignVoice is a university course project, built for education and not for commercial use. Several components below are **non-commercial (NC)**: the system and any model trained from them must not be sold or offered as a commercial service without permission from each owner.

Large models and datasets are not stored in git. `ml/download.py` and `scripts/setup-assets.mjs` download them from their original sources into `%USERPROFILE%\.signvoice` and `public/`, so this repository does not redistribute them.

| Component | Used for | Owner / source | Licence | Obligations |
|---|---|---|---|---|
| MediaPipe Tasks Vision (Hand, Pose, Face, Gesture models) | Landmarks in the browser | Google ([mediapipe](https://github.com/google-ai-edge/mediapipe)) | Apache-2.0 | Attribution |
| IBM Plex Sans, IBM Plex Sans Thai | Web fonts | IBM via [Fontsource](https://fontsource.org/fonts/ibm-plex-sans-thai/) | OFL-1.1 | Licence texts in [public/fonts](public/fonts) |
| **TSL-51** | Training data | Namonpas Viriyaroj, Chulalongkorn University ([Hugging Face](https://huggingface.co/datasets/Namonpas/thai-sign-language-tsl51)) | **CC BY-NC-SA 4.0** | Attribution, non-commercial, share-alike |
| **TSL-ONE / TSL-ONE-S** keypoints | Training data, 184 signs, 29 signers | TSL-ONE team ([tsl-one.github.io](https://tsl-one.github.io/)), IEEE paper "TSL-ONE-S: A Real-World Thai Sign Language Dataset With Deep Learning Benchmarks" | No licence file; the site allows non-profit use after a request form | Local, educational use only; do not redistribute the data or models trained on it; fill in the request form and cite the paper |
| [th-sl.com](https://www.th-sl.com/search-by-word/) dictionary | Checking correct signs by eye | National Association of the Deaf in Thailand | Copyright of the association | Not downloaded, not used for training |
| Trained sign model (`tsl51.onnx`) | Sign recognition | Our training on TSL-51 and TSL-ONE | **CC BY-NC-SA 4.0** (derivative) | Same licence and attribution if shared |
| `public/samples/tsl-sawasdee.mp4` | Test clip ("สวัสดี") | TSL-51 `videos/user_sign` | **CC BY-NC-SA 4.0** | Keep this notice with the file |
| `public/samples/thumbs-up.mp4`, `face-and-thumb.mp4`, `wave-hello.mp4` | Test clips | linoyts, synthetic Wan 2.1 videos ([thumbs up](https://huggingface.co/datasets/linoyts/wan_thumbs_up_gesture), [waving](https://huggingface.co/datasets/linoyts/wan_waving_hands)) | Apache-2.0 | Attribution |
| ASL Signs 1st-place model (`model.tflite`) | Optional ASL recognition in the ML service | Hoyeol Sohn ([Kaggle solution](https://www.kaggle.com/code/hoyso48/1st-place-solution-inference)) | MIT | Attribution |
| **ThonburianTTS** (megaF5 checkpoint, reference voice) | Offline Thai and English speech | Looloo Technology, WordSense, Biomedical and Data Lab, Mahidol University ([Hugging Face](https://huggingface.co/biodatlab/ThonburianTTS), [GitHub](https://github.com/biodatlab/thonburian-tts)) | Model **CC BY-NC-SA 4.0**, code MIT | Attribution, citation below, non-commercial |
| F5-TTS (`f5-tts`) | Runs the TTS model | Yushen Chen et al. ([SWivid/F5-TTS](https://github.com/SWivid/F5-TTS)) | MIT | Attribution |
| Vocos (`charactr/vocos-mel-24khz`) | Vocoder | charactr | MIT | Attribution |
| Ollama, Qwen3 4B Instruct | Sentence ordering | Ollama (MIT), Alibaba Qwen (Apache-2.0) | MIT / Apache-2.0 | |
| Llama 3.2 3B, Gemma 3 4B | Comparison only | Meta, Google | Llama 3.2 Community License, Gemma Terms of Use | Read the terms before publishing |
| ElevenLabs | Cloud speech | ElevenLabs | Commercial API terms | Requires the user's own API key |

## TSL-51 data notes

The dataset card states that the "expert primary" part (two interpreters) is used under fair use for research, and the "expert scraped" part comes from websites of the National Association of the Deaf in Thailand, the Royal Society and TTRS, which may carry copyright restrictions. We use only landmarks (point coordinates, not video) from these parts, train locally for education and do not redistribute them.

## Citations

```bibtex
@dataset{tsl51_2024,
  title  = {TSL-51: Thai Sign Language Dataset},
  author = {Namonpas Viriyaroj},
  year   = {2026},
  url    = {https://huggingface.co/datasets/Namonpas/thai-sign-language-tsl51}
}

@inproceedings{thonburiantts2025,
  author    = {Aung, Thura and Sriwirote, Panyut and Thavornmongkol, Thanachot and Pipatsrisawat, Knot and Achakulvisut, Titipat and Aung, Zaw Htet},
  title     = {ThonburianTTS: Enhancing Neural Flow Matching Models for Authentic Thai Text-to-Speech},
  booktitle = {2025 20th International Joint Symposium on Artificial Intelligence and Natural Language Processing (iSAI-NLP)},
  year      = {2025},
  doi       = {10.1109/iSAI-NLP66160.2025.11320472}
}
```

Google Isolated Sign Language Recognition (Kaggle, 2023): <https://www.kaggle.com/competitions/asl-signs>
