# Headless: print armatures, bone counts and action names for .blend/.glb files.
# blender -b --python blender/inspect.py -- file1 file2 ...
import bpy, sys, os

for p in sys.argv[sys.argv.index("--") + 1:]:
    if p.endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=p)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=p)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    acts = [f"{a.name}({int(a.frame_range[1] - a.frame_range[0])})" for a in bpy.data.actions]
    print("INSPECT", os.path.basename(p), "| arms", [(a.name, len(a.data.bones)) for a in arms], "| meshes", len(meshes), "| actions", len(acts), " ".join(acts[:60]))
