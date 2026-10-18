"""MONAI brats_mri_segmentation bundle. Optional extra: `uv sync --extra monai`.

INPUT_ORDER and OUTPUT_ORDER must match the bundle's configs/metadata.json (Task 9, step 5). A wrong order fails
silently, which is why every monai-segresnet bake records Dice against ground truth."""
from pathlib import Path

import numpy as np

from .labels import exclusive_from_channels

BUNDLE = "brats_mri_segmentation"
INPUT_ORDER: tuple[str, ...] = ()                    # set from metadata.json in step 5; empty refuses to run
OUTPUT_ORDER: tuple[str, ...] = ("tc", "wt", "et")   # confirm in step 5


def channels_to_labels(prob: np.ndarray, output_order: tuple[str, ...] = OUTPUT_ORDER,
                       threshold: float = 0.5) -> np.ndarray:
    ch = {name: prob[i] > threshold for i, name in enumerate(output_order)}
    return exclusive_from_channels(ch["tc"], ch["wt"], ch["et"])


def order_channels(image: np.ndarray, modalities: dict[str, int], input_order: tuple[str, ...]) -> np.ndarray:
    missing = [m for m in input_order if m not in modalities]
    if not input_order or missing:
        raise ValueError(f"MONAI_INPUT_ORDER: set INPUT_ORDER from the bundle metadata (missing {missing})")
    return np.stack([image[..., modalities[m]] for m in input_order], 0)


class MonaiSegmenter:
    def __init__(self, bundle_dir: Path, device: str | None = None):
        import torch
        from monai.bundle import ConfigParser, download

        self._torch = torch
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        root = Path(bundle_dir) / BUNDLE
        if not root.exists():
            download(name=BUNDLE, bundle_dir=str(bundle_dir))
        parser = ConfigParser()
        parser.read_meta(str(root / "configs" / "metadata.json"))
        parser.read_config(str(root / "configs" / "inference.json"))
        parser["bundle_root"] = str(root)
        self.net = parser.get_parsed_content("network_def")
        self.net.load_state_dict(torch.load(root / "models" / "model.pt", map_location=self.device))
        self.net.to(self.device).eval()
        self.inferer = parser.get_parsed_content("inferer")

    def segment(self, case) -> np.ndarray:
        from monai.transforms import NormalizeIntensity

        x = self._torch.from_numpy(order_channels(case.image, case.modalities, INPUT_ORDER))
        x = NormalizeIntensity(nonzero=True, channel_wise=True)(x).unsqueeze(0).to(self.device)
        with self._torch.no_grad():
            prob = self._torch.sigmoid(self.inferer(x, self.net))[0].cpu().numpy()
        return channels_to_labels(prob)
