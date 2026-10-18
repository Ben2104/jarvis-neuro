import numpy as np
import pytest

from jarvis_neuro.labels import ED, ET, NCR
from jarvis_neuro.segment_monai import channels_to_labels, order_channels


def test_channels_to_labels_uses_named_order():
    prob = np.zeros((3, 5))                 # tc, wt, et
    prob[1, 0:5] = 0.9
    prob[0, 1:4] = 0.9
    prob[2, 2] = 0.9
    assert channels_to_labels(prob, ("tc", "wt", "et")).tolist() == [ED, NCR, ET, NCR, ED]


def test_channels_to_labels_refuses_unverified_default_order():
    with pytest.raises(ValueError, match="MONAI_OUTPUT_ORDER"):
        channels_to_labels(np.zeros((3, 5)))


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
