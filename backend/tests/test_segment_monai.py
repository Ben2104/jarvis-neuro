import numpy as np
import pytest

from jarvis_neuro.labels import ED, ET, NCR
from jarvis_neuro.segment_monai import INPUT_ORDER, OUTPUT_ORDER, channels_to_labels, order_channels


def test_channels_to_labels_uses_named_order():
    prob = np.zeros((3, 5))                 # tc, wt, et
    prob[1, 0:5] = 0.9
    prob[0, 1:4] = 0.9
    prob[2, 2] = 0.9
    assert channels_to_labels(prob, ("tc", "wt", "et")).tolist() == [ED, NCR, ET, NCR, ED]


def test_bundle_input_order():
    assert INPUT_ORDER == ("t1gd", "t1w", "t2w", "flair")
    img = np.stack([np.full((2, 2, 2), v, np.float32) for v in range(4)], -1)
    out = order_channels(img, {"flair": 0, "t1w": 1, "t1gd": 2, "t2w": 3}, INPUT_ORDER)
    assert out[:, 0, 0, 0].tolist() == [2, 1, 3, 0]


def test_bundle_output_order_and_default_conversion():
    assert OUTPUT_ORDER == ("tc", "wt", "et")
    prob = np.zeros((3, 4))
    prob[0, 1] = 0.9   # Tumor core
    prob[1, 0] = 0.9   # Whole tumor
    prob[2, 2] = 0.9   # Enhancing tumor
    assert channels_to_labels(prob).tolist() == [ED, NCR, ET, 0]


def test_channels_to_labels_matches_bundle_threshold_boundary():
    below = np.nextafter(np.float32(0.5), np.float32(0))
    above = np.nextafter(np.float32(0.5), np.float32(1))
    prob = np.zeros((3, 9), np.float32)
    for channel in range(3):
        prob[channel, channel * 3:channel * 3 + 3] = [below, 0.5, above]
    assert channels_to_labels(prob).tolist() == [0, NCR, NCR, 0, ED, ED, 0, ET, ET]


@pytest.mark.parametrize("order", [(), ("tc", "wt"), ("tc", "et"), ("wt", "et")])
def test_channels_to_labels_refuses_missing_output_channels(order):
    with pytest.raises(ValueError, match="MONAI_OUTPUT_ORDER"):
        channels_to_labels(np.zeros((3, 5)), order)


def test_order_channels_refuses_unset_order():
    with pytest.raises(ValueError, match="MONAI_INPUT_ORDER"):
        order_channels(np.zeros((2, 2, 2, 4)), {"flair": 0}, ())


def test_order_channels_stacks_requested_modalities():
    img = np.stack([np.full((2, 2, 2), v, np.float32) for v in range(4)], -1)
    out = order_channels(img, {"flair": 0, "t1w": 1, "t1gd": 2, "t2w": 3}, ("t1gd", "t1w", "t2w", "flair"))
    assert out[:, 0, 0, 0].tolist() == [2, 1, 3, 0]
