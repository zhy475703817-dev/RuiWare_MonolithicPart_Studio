import math

import pytest

from template_core.sweep_frames import (
    cross,
    dot,
    fixed_world_frames,
    follow_path_frames,
    minimum_twist_frames,
    normalize,
    path_frames,
    segment_start_frames,
    segment_tangents,
)


def _assert_frame(frame):
    _origin, x, y, tangent = frame
    assert math.isclose(math.sqrt(dot(x, x)), 1.0, abs_tol=1e-8)
    assert math.isclose(math.sqrt(dot(y, y)), 1.0, abs_tol=1e-8)
    assert math.isclose(math.sqrt(dot(tangent, tangent)), 1.0, abs_tol=1e-8)
    assert abs(dot(x, y)) < 1e-8
    assert abs(dot(x, tangent)) < 1e-8
    assert abs(dot(y, tangent)) < 1e-8
    assert dot(cross(x, y), tangent) > 0.999999


def test_straight_path_frames_are_orthonormal_and_directional():
    points = [(0, 0, 0), (0, 0, 100)]
    assert segment_tangents(points) == [(0.0, 0.0, 1.0)]
    for mode in ("minimumTwist", "followPath", "fixedWorld"):
        frames = path_frames(points, mode)
        assert len(frames) == 2
        for frame in frames:
            _assert_frame(frame)
            assert frame[3] == (0.0, 0.0, 1.0)


def test_right_angle_and_multi_segment_path_transport():
    points = [(0, 0, 0), (0, 0, 100), (100, 0, 100), (100, 50, 100)]
    frames = minimum_twist_frames(points)
    assert len(frames) == len(points)
    for frame in frames:
        _assert_frame(frame)
    assert frames[0][3] == (0.0, 0.0, 1.0)
    assert frames[-1][3] == (0.0, 1.0, 0.0)


def test_closed_path_and_orientation_modes():
    points = [(0, 0, 0), (100, 0, 0), (100, 0, 100), (0, 0, 100), (0, 0, 0)]
    for mode, builder in (("minimumTwist", minimum_twist_frames), ("followPath", follow_path_frames), ("fixedWorld", fixed_world_frames)):
        frames = builder(points)
        assert len(frames) == len(points)
        for frame in frames:
            _assert_frame(frame)
        assert frames[0][0] == frames[-1][0]


def test_zero_length_and_unsupported_mode_are_rejected():
    with pytest.raises(ValueError, match="zero-length"):
        segment_tangents([(0, 0, 0), (0, 0, 0)])
    with pytest.raises(ValueError, match="unsupported"):
        path_frames([(0, 0, 0), (0, 0, 1)], "roll")


def test_reverse_segment_keeps_a_stable_frame():
    frames = minimum_twist_frames([(0, 0, 0), (0, 0, 10), (0, 0, 0)])
    for frame in frames:
        _assert_frame(frame)


def test_segment_start_frames_are_normal_to_each_edge_for_all_modes():
    points = [(0, 0, 0), (0, 0, 100), (100, 0, 100), (100, 0, 200)]
    expected = segment_tangents(points)
    for mode in ("followPath", "fixedWorld", "minimumTwist"):
        frames = segment_start_frames(points, mode)
        assert len(frames) == len(expected)
        for frame, tangent in zip(frames, expected):
            _assert_frame(frame)
            assert frame[3] == tangent


def test_segment_start_frames_reject_degenerate_and_unknown_modes():
    with pytest.raises(ValueError, match="zero-length"):
        segment_start_frames([(0, 0, 0), (0, 0, 0)], "followPath")
    with pytest.raises(ValueError, match="unsupported"):
        segment_start_frames([(0, 0, 0), (0, 0, 1)], "roll")
