import bpy, sys, os
for p in sys.argv[sys.argv.index("--") + 1:]:
    if p.endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=p)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=p)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    ms = [o for o in bpy.data.objects if o.type == "MESH"]
    vs = [m.matrix_world @ v.co for m in ms for v in m.data.vertices]
    ext = [round(max(v[i] for v in vs) - min(v[i] for v in vs), 2) for i in range(3)]
    mw = arm.matrix_world
    print("B", os.path.basename(p), "ext xyz", ext)
    for b in arm.data.bones:
        h = mw @ b.head_local; t = mw @ b.tail_local
        print("B   ", b.name, "<", b.parent.name if b.parent else "-", "def" if b.use_deform else "nodef", tuple(round(x, 2) for x in h), tuple(round(x, 2) for x in t))
