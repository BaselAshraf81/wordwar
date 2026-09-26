# Headless export of artist-rigged models to GLB for the game, in rest pose, no animation.
# Run: blender -b --python blender/export_models.py -- <src_dir> <out_dir> Name1 Name2 ...
# Prints one JSON line per model with bone and mesh facts used to build the physics body.
import bpy, json, os, sys

args = sys.argv[sys.argv.index("--") + 1:]
src, out, names = args[0], args[1], args[2:]
os.makedirs(out, exist_ok=True)
facts = []

for name in names:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(src, name + ".blend"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    import math
    mw0 = arm.matrix_world
    deform = [b.name for b in arm.data.bones if b.use_deform and not b.name.lower().startswith("ik")]

    def side_angle(h, t):
        return math.atan2(t[2] - h[2], t[0] - h[0])

    rest = {b.name: side_angle(mw0 @ b.head_local, mw0 @ b.tail_local) for b in arm.data.bones}
    # Sample each clip with its IK/constraints live: joint angle = change in the bone's side-view
    # angle relative to its parent, versus the rest pose. That is exactly a 2D revolute joint angle.
    clips = {}
    scene = bpy.context.scene
    if not arm.animation_data:
        arm.animation_data_create()
    for act in bpy.data.actions:
        arm.animation_data.action = act
        try:
            slots = getattr(act, "slots", None)
            if slots:
                arm.animation_data.action_slot = slots[0]
        except Exception:
            pass
        f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
        n = 24
        frames = []
        for i in range(n):
            scene.frame_set(round(f0 + (f1 - f0) * i / n))
            ang = {}
            for bn in deform:
                pb = arm.pose.bones[bn]
                a = side_angle(mw0 @ pb.head, mw0 @ pb.tail)
                par = pb.parent
                pa = side_angle(mw0 @ par.head, mw0 @ par.tail) if par else 0.0
                r = rest[bn] - (rest[par.name] if par else 0.0)
                d = (a - pa) - r
                ang[bn] = round(math.atan2(math.sin(d), math.cos(d)), 3)
            root = arm.pose.bones[deform[0]]
            ang["_rootZ"] = round((mw0 @ root.head)[2] - (mw0 @ arm.data.bones[deform[0]].head_local)[2], 3)
            ang["_rootA"] = round(side_angle(mw0 @ root.head, mw0 @ root.tail) - rest[deform[0]], 3)
            frames.append(ang)
        clips[act.name] = frames
    scene.frame_set(0)
    if arm.animation_data:
        arm.animation_data_clear()
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    # Drop IK helper bones; the game drives every deform bone itself.
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in list(arm.data.edit_bones):
        if not eb.use_deform or eb.name.lower().startswith("ik"):
            arm.data.edit_bones.remove(eb)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for m in meshes:
        m.select_set(True)
    path = os.path.join(out, name.lower() + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_animations=False, export_skins=True)
    mw = arm.matrix_world
    import math
    bones = [
        {"name": b.name, "parent": b.parent.name if b.parent else None,
         "head": [round(v, 3) for v in (mw @ b.head_local)], "tail": [round(v, 3) for v in (mw @ b.tail_local)]}
        for b in arm.data.bones
    ]
    zs = [(m.matrix_world @ v.co).z for m in meshes for v in m.data.vertices]
    xs = [(m.matrix_world @ v.co).x for m in meshes for v in m.data.vertices]
    # Side-view thickness per bone from the artist's skin weights: distance (in the x/z plane)
    # from each vertex to the bone it is mostly weighted to, 85th percentile.
    import math
    dist = {b["name"]: [] for b in bones}
    bmap = {b["name"]: b for b in bones}
    for m in meshes:
        gname = {g.index: g.name for g in m.vertex_groups}
        for v in m.data.vertices:
            if not v.groups:
                continue
            g = max(v.groups, key=lambda e: e.weight)
            bn = gname.get(g.group)
            if bn not in bmap or g.weight < 0.5:
                continue
            p = m.matrix_world @ v.co
            h, t = bmap[bn]["head"], bmap[bn]["tail"]
            ax, az = t[0] - h[0], t[2] - h[2]
            L2 = ax * ax + az * az or 1e-9
            u = max(0.0, min(1.0, ((p.x - h[0]) * ax + (p.z - h[2]) * az) / L2))
            dist[bn].append(math.hypot(p.x - (h[0] + u * ax), p.z - (h[2] + u * az)))
    for b in bones:
        d = sorted(dist[b["name"]])
        b["radius"] = round(d[int(0.85 * (len(d) - 1))], 3) if d else None
    facts.append({"name": name, "kb": os.path.getsize(path) // 1024, "height": round(max(zs) - min(zs), 3),
                                 "ground": round(min(zs), 3), "xmin": round(min(xs), 3), "xmax": round(max(xs), 3), "bones": bones, "clips": clips})

with open(os.path.join(out, 'facts.json'), 'w') as fh:
    json.dump(facts, fh)
print('WROTE', len(facts))
