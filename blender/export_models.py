# Headless export of artist-rigged models for the 2D physics game.
#   blender -b --python blender/export_models.py -- <out_dir> <path>::<id>::<fwd> ...
# fwd = the Blender axis the model faces (+x, -x, +y, -y); it is turned to face +x.
#
# For each model this writes <out_dir>/<id>.glb (rest pose, no animation, full skeleton) and
# appends to <out_dir>/facts.json:
#   groups: physics bodies, each a set of the artist's bones that move together, with a
#           side-view segment (a->b), thickness from the artist's skin weights, parent group.
#   clips:  canonical clips (walk, run, idle, attack, headbutt, kick, ...) sampled as the joint
#           angle of every group relative to its parent group, i.e. 2D revolute targets.
# Nothing is guessed from pixels: roles come from the artist's bone names and hierarchy.
import bpy, json, math, os, sys
from mathutils import Matrix

args = sys.argv[sys.argv.index("--") + 1:]
out = args[0]
os.makedirs(out, exist_ok=True)
facts = []
ROT = {"+x": 0.0, "-y": math.pi / 2, "+y": -math.pi / 2, "-x": math.pi}

CANON = [  # (canonical name, predicate on lowercased action name) - first match wins
    ("kick", lambda n: "kick" in n),
    ("headbutt", lambda n: "headbutt" in n),
    ("slash", lambda n: "sword_attack" in n),
    ("punch", lambda n: "punch_cross" in n),
    ("attack", lambda n: n.endswith("attack") or n == "attack"),
    ("run", lambda n: ("gallop" in n and "jump" not in n) or n.endswith("_run") or n.startswith("sprint")),
    ("walk", lambda n: n == "walk" or n.endswith("_walk") or n == "walk_loop"),
    ("idle", lambda n: n in ("idle", "idle_loop") or (n.endswith("_idle") and "sword" not in n)),
    ("death", lambda n: "death" in n),
    ("hit", lambda n: "hitreact_left" in n or n == "hit_chest"),
]


def side(v):
    return (v[0], v[2])


def ang(a, b):
    return math.atan2(b[1] - a[1], b[0] - a[0])


def wrap(d):
    return math.atan2(math.sin(d), math.cos(d))


for spec in args[1:]:
    path, mid, fwd = spec.split("::")
    bpy.ops.wm.open_mainfile(filepath=path)
    R = Matrix.Rotation(ROT[fwd], 4, "Z")
    for o in bpy.data.objects:
        if o.parent is None:
            o.matrix_world = R @ o.matrix_world
    bpy.context.view_layer.update()
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    mw = arm.matrix_world
    B = {b.name: b for b in arm.data.bones}
    rh = {n: mw @ b.head_local for n, b in B.items()}
    rt = {n: mw @ b.tail_local for n, b in B.items()}
    verts = [m.matrix_world @ v.co for m in meshes for v in m.data.vertices]
    ground = min(v.z for v in verts)
    H = max(v.z for v in verts) - ground
    xmin, xmax = min(v.x for v in verts), max(v.x for v in verts)
    head = next((n for n in B if n.lower() == "head"), None)
    if not head:
        print("SKIP", mid, "no Head bone")
        continue
    slen = lambda n: math.hypot(rt[n].x - rh[n].x, rt[n].z - rh[n].z)

    # Virtual hierarchy: IK targets and floating foot bones hang off the nearest leg end.
    anc = []
    n = head
    while n:
        anc.append(n)
        n = B[n].parent.name if B[n].parent else None
    top = anc[-1]
    vp = {n: (b.parent.name if b.parent else None) for n, b in B.items()}
    for n in B:
        if n in anc or (vp[n] not in (None, top)):
            continue
        cands = [c for c in B if c not in anc and c != n and vp.get(c) not in (None,) and not c.lower().startswith(("ik", "pole"))]
        if cands:
            vp[n] = min(cands, key=lambda c: (rt[c] - rh[n]).length)
    kids = {n: [c for c in B if vp[c] == n] for n in B}

    def subtree(n):
        s, st = [], [n]
        while st:
            x = st.pop()
            s.append(x)
            st.extend(kids[x])
        return s

    group_of = {}
    groups = []

    def new_group(gid, role, bones, parent, a, b):
        g = {"id": gid, "role": role, "bones": list(bones), "parent": parent, "pa": a, "pb": b}
        groups.append(g)
        for x in bones:
            group_of[x] = gid
        return g

    neck = [n for n in anc if "neck" in n.lower()]
    torso_b = [n for n in anc if n != head and n not in neck]
    front = (neck[-1] if neck else head, "head")  # neck base: head of the neck bone nearest the torso
    rear = min(((n, e) for n in torso_b for e in ("head", "tail")), key=lambda p: (rh if p[1] == "head" else rt)[p[0]].x)
    new_group("torso", "torso", torso_b, None, rear, front)
    if neck:
        new_group("neck", "neck", neck, "torso", (neck[-1], "head"), (neck[0], "tail"))
    new_group("head", "head", [head], "neck" if neck else "torso", (head, "head"), (head, "tail"))

    counts = {"leg": 0, "limb": 0, "tail": 0}
    for n in B:
        if vp[n] not in torso_b + neck or n in anc:
            continue
        sub = subtree(n)
        low = min(min(rh[x].z, rt[x].z) for x in sub) - ground
        if any("tail" in x.lower() for x in sub):
            role = "tail"
        elif low < 0.12 * H:
            role = "leg"
        elif max(slen(x) for x in sub) > 0.15 * H:
            role = "limb"
        else:
            continue  # small branch: passenger of its parent
        # Main chain: follow the child whose subtree reaches lowest (legs) or is largest.
        chain, x = [], n
        while x:
            chain.append(x)
            ks = kids[x]
            if not ks:
                break
            key = (lambda c: min(min(rh[y].z, rt[y].z) for y in subtree(c))) if role == "leg" else (lambda c: -len(subtree(c)))
            x = min(ks, key=key)
        segs, cur = [], None
        for x in chain:
            if slen(x) < 0.1 * H:
                if cur is not None:
                    cur.append(x)
                else:
                    group_of[x] = group_of[vp[x]]  # shoulder/hip stub rides the body
            else:
                cur = [x]
                segs.append(cur)
        cap = 3 if role == "leg" else 2
        while len(segs) > cap:
            segs[-2].extend(segs.pop())
        if not segs:
            continue
        i = counts[role]
        counts[role] += 1
        parent = group_of[vp[chain[0]]]
        for k, sg in enumerate(segs):
            gid = f"{role}{i}_{k}"
            new_group(gid, role, sg, parent, (sg[0], "head"), (sg[-1], "tail"))
            parent = gid
    # Everything else (ears, fingers, IK helpers, stubs) rides its nearest grouped ancestor.
    for n in B:
        x = n
        while x not in group_of:
            x = vp[x]
            if x is None:
                break
        group_of[n] = group_of.get(x, "torso") if x else "torso"

    def pt(p, pose=False):
        n, e = p
        if pose:
            pb = arm.pose.bones[n]
            return side(mw @ (pb.head if e == "head" else pb.tail))
        return side(rh[n] if e == "head" else rt[n])

    rest_ang = {g["id"]: ang(pt(g["pa"]), pt(g["pb"])) for g in groups}

    # Thickness from skin weights: side-view distance of each vertex to its group's segment.
    dist = {g["id"]: [] for g in groups}
    gs = {g["id"]: g for g in groups}
    for m in meshes:
        gname = {vg.index: vg.name for vg in m.vertex_groups}
        for v in m.data.vertices:
            if not v.groups:
                continue
            best = max(v.groups, key=lambda e: e.weight)
            bn = gname.get(best.group)
            if bn not in group_of or best.weight < 0.4:
                continue
            g = gs[group_of[bn]]
            p = m.matrix_world @ v.co
            a, b = pt(g["pa"]), pt(g["pb"])
            ax, az = b[0] - a[0], b[1] - a[1]
            L2 = ax * ax + az * az or 1e-9
            u = max(0.0, min(1.0, ((p.x - a[0]) * ax + (p.z - a[1]) * az) / L2))
            dist[g["id"]].append(math.hypot(p.x - (a[0] + u * ax), p.z - (a[1] + u * az)))

    # Clips, sampled with the artist's IK and constraints live.
    clips = {}
    scene = bpy.context.scene
    if not arm.animation_data:
        arm.animation_data_create()
    for act in bpy.data.actions:
        name = next((c for c, pred in CANON if pred(act.name.lower().split("|")[-1].replace(mid.lower() + "_", ""))), None)
        low = act.name.lower()
        if name is None:
            for c, pred in CANON:
                if pred(low.split("_", 1)[-1]) or pred(low):
                    name = c
                    break
        if name is None or name in clips:
            continue
        arm.animation_data.action = act
        slots = getattr(act, "slots", None)
        if slots:
            try:
                arm.animation_data.action_slot = slots[0]
            except Exception:
                pass
        f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
        n = 24
        frames = []
        for i in range(n):
            scene.frame_set(round(f0 + (f1 - f0) * i / n))
            cur = {g["id"]: ang(pt(g["pa"], True), pt(g["pb"], True)) for g in groups}
            fr = {}
            for g in groups:
                if g["parent"]:
                    d = (cur[g["id"]] - cur[g["parent"]]) - (rest_ang[g["id"]] - rest_ang[g["parent"]])
                    fr[g["id"]] = round(wrap(d), 3)
            ta, tb = pt(gs["torso"]["pa"], True), pt(gs["torso"]["pb"], True)
            ra, rb = pt(gs["torso"]["pa"]), pt(gs["torso"]["pb"])
            fr["_rootA"] = round(wrap(cur["torso"] - rest_ang["torso"]), 3)
            fr["_rootZ"] = round(((ta[1] + tb[1]) - (ra[1] + rb[1])) / 2 / H, 3)
            frames.append(fr)
        clips[name] = frames
    scene.frame_set(0)

    # Export: bake the virtual hierarchy so skinned feet follow the legs, rest pose, no animation.
    arm.animation_data_clear()
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for n, p in vp.items():
        cur = eb[n].parent.name if eb[n].parent else None
        if p != cur:
            eb[n].use_connect = False
            eb[n].parent = eb[p] if p else None
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for m in meshes:
        m.select_set(True)
    glb = os.path.join(out, mid + ".glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_animations=False, export_skins=True)

    G = lambda p: [round(p[0], 4), round(p[1] - ground, 4)]
    outg = []
    for g in groups:
        d = sorted(dist[g["id"]])
        a, b = pt(g["pa"]), pt(g["pb"])
        outg.append({
            "id": g["id"], "role": g["role"], "parent": g["parent"], "a": G(a), "b": G(b),
            "r": round(d[int(0.85 * (len(d) - 1))], 4) if d else round(0.06 * H, 4),
            "depth": round(sum(rh[x].y for x in g["bones"]) / len(g["bones"]), 4),
        })
    facts.append({"id": mid, "height": round(H, 4), "ground": round(ground, 4), "xmin": round(xmin, 4), "xmax": round(xmax, 4),
                  "kb": os.path.getsize(glb) // 1024, "groups": outg, "bones": group_of, "clips": clips})
    print("MODEL", mid, "groups", [g["id"] for g in outg], "clips", list(clips))

with open(os.path.join(out, "facts.json"), "w") as fh:
    json.dump(facts, fh)
print("WROTE", len(facts))
