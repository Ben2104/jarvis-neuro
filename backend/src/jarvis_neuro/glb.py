import subprocess
from pathlib import Path

import numpy as np
import trimesh


def write_glb(nodes: list[tuple[str, np.ndarray, np.ndarray]], path: Path) -> None:
    """One glTF node per asset, named by asset id. Vertices are written as given (glTF frame, millimetres)."""
    scene = trimesh.Scene()
    for name, v, f in nodes:
        scene.add_geometry(trimesh.Trimesh(v, f, process=False), node_name=name, geom_name=name)
    Path(path).write_bytes(scene.export(file_type="glb"))


def draco_compress(path: Path) -> None:
    path = Path(path)
    tmp = path.with_suffix(".draco.glb")
    subprocess.run(["npx", "--yes", "@gltf-transform/cli", "draco", str(path), str(tmp)], check=True)
    tmp.replace(path)
