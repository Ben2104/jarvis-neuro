import fast_simplification
import numpy as np
import trimesh

from .geometry import signed_volume


def smooth_and_decimate(verts: np.ndarray, faces: np.ndarray, target_faces: int, iterations: int = 10):
    """Taubin smoothing (does not shrink, unlike Laplacian), then quadric decimation to about target_faces."""
    if len(faces) == 0:
        return verts.astype(np.float32), faces.astype(np.uint32)
    mesh = trimesh.Trimesh(verts, faces, process=False)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=0.53, iterations=iterations)
    v, f = np.asarray(mesh.vertices), np.asarray(mesh.faces)
    if len(f) > target_faces:
        v, f = fast_simplification.simplify(v, f, target_reduction=1 - target_faces / len(f))
    v, f = np.asarray(v, np.float32), np.asarray(f, np.uint32)
    if signed_volume(v, f) < 0:
        f = f[:, ::-1].copy()
    return v, f
