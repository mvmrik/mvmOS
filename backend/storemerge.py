"""Merged store browsing.

Apps, widgets and themes can each come from several stores (the official one
plus any the owner added). Browsing them one store at a time makes people hunt
for things, so this builds ONE category tree out of all of them:

  * categories with the same name (case-insensitive) become one category;
  * a category only one store has stays as its own category;
  * items without a category go to a shared "Other" category;
  * the same item id in several stores is listed once, and the official store
    wins (then the store that was added first).

Every item is tagged with the store it comes from so the desktop can mark
official items and name the source of the others.
"""
import asyncio

OTHER_ID = "_other"
_MAX_DEPTH = 5


def _norm(name) -> str:
    return str(name or "").strip().lower()


async def _load_node(url: str, item_key: str, fetch, depth: int = 0) -> dict:
    """One manifest → {"categories": [...], "items": [...]}."""
    data = await fetch(url)
    return await _node_from(data, item_key, fetch, depth)


async def _node_from(data: dict, item_key: str, fetch, depth: int) -> dict:
    cats = []
    refs = [c for c in data.get("categories", []) if isinstance(c, dict)]
    if refs and depth < _MAX_DEPTH:
        async def load(ref):
            url = ref.get("manifest_url")
            if not url:
                return None
            try:
                return await _load_node(url, item_key, fetch, depth + 1)
            except Exception:
                return None
        nodes = await asyncio.gather(*(load(r) for r in refs))
        for ref, node in zip(refs, nodes):
            if node is None:
                continue
            cats.append({
                "id": ref.get("id") or _norm(ref.get("name")),
                "name": ref.get("name") or ref.get("id") or "",
                "icon": ref.get("icon") or "",
                "categories": node["categories"],
                "items": node["items"],
            })

    items = [i for i in data.get(item_key, []) if isinstance(i, dict) and i.get("id")]
    if depth == 0 and not cats:
        # v1 layout: one flat list where every item names its own category.
        grouped: dict = {}
        loose = []
        for it in items:
            name = it.get("category")
            if name:
                grouped.setdefault(name, []).append(it)
            else:
                loose.append(it)
        for name, group in grouped.items():
            cats.append({"id": _norm(name), "name": name, "icon": "", "categories": [], "items": group})
        items = loose
    return {"categories": cats, "items": items}


def _merge_node(target: dict, node: dict, store: dict, seen: set):
    """Fold one store's tree into the merged one. Stores are folded in priority
    order, so an item id already seen belongs to a stronger store."""
    for it in node["items"]:
        if it["id"] in seen:
            continue
        seen.add(it["id"])
        target["items"].append({
            **it,
            "official": store["official"],
            "store_id": store["id"],
            "store_name": store["name"],
        })
    for cat in node["categories"]:
        key = _norm(cat["name"])
        dest = next((c for c in target["categories"] if _norm(c["name"]) == key), None)
        if dest is None:
            dest = {"id": cat["id"], "name": cat["name"], "icon": cat["icon"], "categories": [], "items": []}
            target["categories"].append(dest)
        elif not dest["icon"]:
            dest["icon"] = cat["icon"]
        _merge_node(dest, cat, store, seen)


def _prune(node: dict) -> int:
    """Drop categories left with nothing in them and count what remains."""
    kept = []
    total = len(node["items"])
    for cat in node["categories"]:
        n = _prune(cat)
        if n:
            cat["count"] = n
            kept.append(cat)
            total += n
    node["categories"] = kept
    return total


def _annotate(node: dict, annotate):
    node["items"] = annotate(node["items"])
    for cat in node["categories"]:
        _annotate(cat, annotate)


async def build_merged_tree(stores: list, item_key: str, fetch, annotate) -> dict:
    """stores: dicts with id, name, official, manifest_url.
    Returns {"categories": [...], "errors": [store names that could not be read]}."""
    ordered = sorted(stores, key=lambda s: (0 if s["official"] else 1, s.get("added_at") or 0, s["id"]))

    async def load(store):
        try:
            return await _load_node(store["manifest_url"], item_key, fetch)
        except Exception:
            return None
    nodes = await asyncio.gather(*(load(s) for s in ordered))

    merged = {"categories": [], "items": []}
    seen: set = set()
    errors = []
    for store, node in zip(ordered, nodes):
        if node is None:
            errors.append(store["name"])
            continue
        _merge_node(merged, node, store, seen)

    # Items that no store put in any category share one "Other" category.
    if merged["items"]:
        other = next((c for c in merged["categories"] if _norm(c["name"]) == "other"), None)
        if other:
            other["items"].extend(merged["items"])
        else:
            merged["categories"].append({
                "id": OTHER_ID, "name": "Other", "icon": "", "categories": [], "items": merged["items"]})
        merged["items"] = []

    _prune(merged)
    _annotate(merged, annotate)
    return {"categories": merged["categories"], "errors": errors}
