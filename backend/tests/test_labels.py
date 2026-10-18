import numpy as np
import pytest

from jarvis_neuro.labels import (
    ED, ET, NCR, exclusive_from_channels, label_map_from_dataset_json, remap,
)

MSD_LABELS = {"0": "background", "1": "edema", "2": "non-enhancing tumor", "3": "enhancing tumour"}


def test_msd_names_map_to_our_convention():
    assert label_map_from_dataset_json(MSD_LABELS) == {1: ED, 2: NCR, 3: ET}


def test_non_enhancing_is_not_mistaken_for_enhancing():
    m = label_map_from_dataset_json({"0": "background", "1": "enhancing", "2": "non-enhancing", "3": "edema"})
    assert m == {1: ET, 2: NCR, 3: ED}


def test_unknown_label_fails_loudly():
    with pytest.raises(ValueError, match="LABEL_UNKNOWN"):
        label_map_from_dataset_json({"0": "background", "1": "edema", "2": "cyst"})


def test_incomplete_labels_fail_loudly():
    with pytest.raises(ValueError, match="LABEL_INCOMPLETE"):
        label_map_from_dataset_json({"0": "background", "1": "edema"})


def test_remap_applies_mapping_and_rejects_unmapped_values():
    seg = np.array([[0, 1], [2, 3]])
    assert remap(seg, {1: ET, 2: NCR, 3: ED}).tolist() == [[0, ET], [NCR, ED]]
    with pytest.raises(ValueError, match="LABEL_UNMAPPED"):
        remap(np.array([0, 4]), {1: ED})


def test_channels_become_exclusive_labels():
    wt = np.zeros(9, bool); wt[1:8] = True
    tc = np.zeros(9, bool); tc[2:7] = True
    et = np.zeros(9, bool); et[3:5] = True
    out = exclusive_from_channels(tc, wt, et)
    assert out.tolist() == [0, ED, NCR, ET, ET, NCR, NCR, ED, 0]
    assert ((out > 0) == wt).all()
