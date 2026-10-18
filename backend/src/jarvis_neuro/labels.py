"""Label conventions. Output labels follow MSD Task01: 1 edema, 2 non-enhancing (necrotic) core, 3 enhancing."""
import numpy as np

ED, NCR, ET = 1, 2, 3
TUMOR_LABELS = (ET, NCR, ED)
ASSET_BY_LABEL = {ET: "tumor_et", NCR: "tumor_ncr", ED: "tumor_ed"}
LABEL_BY_ASSET = {v: k for k, v in ASSET_BY_LABEL.items()}
COLOR_BY_LABEL = {ET: "#E8705A", NCR: "#7A2E3A", ED: "#E3A857"}


def label_map_from_dataset_json(labels: dict[str, str]) -> dict[int, int]:
    """Map source label values to ours by name. Fails loudly on anything unrecognised."""
    out: dict[int, int] = {}
    for value, name in labels.items():
        v, n = int(value), name.lower()
        if v == 0:
            continue
        if "edema" in n or "oedema" in n:
            out[v] = ED
        elif "non-enhancing" in n or "necrotic" in n:   # before "enhancing": it is a substring
            out[v] = NCR
        elif "enhancing" in n:
            out[v] = ET
        else:
            raise ValueError(f"LABEL_UNKNOWN: {value}={name!r}")
    if sorted(out.values()) != [ED, NCR, ET]:
        raise ValueError(f"LABEL_INCOMPLETE: {labels}")
    return out


def remap(seg: np.ndarray, mapping: dict[int, int]) -> np.ndarray:
    seg = np.asarray(seg).astype(np.int64)
    unknown = set(np.unique(seg).tolist()) - {0} - set(mapping)
    if unknown:
        raise ValueError(f"LABEL_UNMAPPED: {sorted(unknown)}")
    lut = np.zeros(int(seg.max(initial=0)) + 1, np.uint8)
    for k, v in mapping.items():
        if k < lut.size:
            lut[k] = v
    return lut[seg]


def exclusive_from_channels(tc: np.ndarray, wt: np.ndarray, et: np.ndarray) -> np.ndarray:
    """Overlapping TC/WT/ET channels → exclusive labels: ED = WT−TC, NCR = TC−ET, ET = ET."""
    out = np.zeros(wt.shape, np.uint8)
    out[wt] = ED
    out[tc] = NCR
    out[et] = ET
    return out
