import os
from pathlib import Path

# Large datasets and model weights live outside the repo (and outside OneDrive sync).
HOME = Path(os.environ.get('SIGNVOICE_HOME', Path.home() / '.signvoice'))
