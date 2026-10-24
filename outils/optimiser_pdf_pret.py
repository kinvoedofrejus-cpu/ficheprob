#!/usr/bin/env python3
"""Diagnostic + optimisation d'un PDF « Fiche Prête » de base (celui déposé dans R2).

Usage :
    python3 optimiser_pdf_pret.py diag   CE1-mathematique.pdf
    python3 optimiser_pdf_pret.py fix    CE1-mathematique.pdf  [sortie.pdf]

  diag : n'écrit rien. Affiche ce qui pèse (images, polices, contenu), les doublons et les flux non compressés.
  fix  : fabrique une version allégée. Le NOMBRE DE PAGES ET LEUR ORDRE NE CHANGENT PAS, donc le
         fichier .meta.json existant reste valable : il suffit de redéposer le PDF via
         admin-upload-readyfiche-pdfs.html (même nom, la matière est remplacée).

Ce que fait « fix » (sans rien changer à l'apparence du texte) :
  1. fusionne les objets strictement identiques (polices, images, flux répétés une fois par fiche) ;
  2. recompresse tous les flux (Flate niveau max) et regroupe les objets (object streams) ;
  3. réencode en JPEG les grosses images opaques (qualité 72, 1500 px max) — c'est ce qui fait
     passer un PDF « capturé en images » de plusieurs centaines de Mo à quelques Mo.
Dépendances : pip install pikepdf pillow
"""
import sys, os, io, hashlib, collections
import pikepdf
from pikepdf import Name, Dictionary, Array, Stream, PdfImage

IMG_MAX_PX = 1500
JPEG_Q = 72
BIG_IMG = 60 * 1024          # on ne touche qu'aux images > 60 Ko

def mo(n): return f"{n/1048576:.2f} Mo"

def stream_key(obj):
    d = {str(k): str(v) for k, v in obj.items() if str(k) not in ('/Length',)}
    return hashlib.sha1((repr(sorted(d.items())) + '|').encode() + obj.read_raw_bytes()).hexdigest()

def classify(obj):
    t = str(obj.get('/Subtype', ''))
    if t == '/Image': return 'image'
    if '/Length1' in obj or '/Length2' in obj or t in ('/CIDFontType0C', '/OpenType', '/Type1C'): return 'police'
    if t == '/Form': return 'formulaire'
    return 'contenu/autre'

def diag(path):
    size = os.path.getsize(path)
    pdf = pikepdf.open(path)
    print(f"Fichier : {path}\nTaille  : {mo(size)}   Pages : {len(pdf.pages)}   ({mo(size/max(1,len(pdf.pages)))} par page)")
    tot = collections.Counter(); cnt = collections.Counter(); seen = collections.defaultdict(set)
    dup_bytes = 0; uncompressed = 0; unc_bytes = 0; biggest = []
    for obj in pdf.objects:
        if not isinstance(obj, Stream): continue
        raw = obj.read_raw_bytes(); n = len(raw); kind = classify(obj)
        tot[kind] += n; cnt[kind] += 1
        k = stream_key(obj)
        if k in seen[kind]: dup_bytes += n
        seen[kind].add(k)
        if '/Filter' not in obj and n > 2048: uncompressed += 1; unc_bytes += n
        biggest.append((n, kind, str(obj.get('/Width', '')) + 'x' + str(obj.get('/Height', ''))))
    print("\nRépartition :")
    for kind, n in tot.most_common():
        print(f"  {kind:14s} {mo(n):>12s}   ({cnt[kind]} objets, {len(seen[kind])} distincts)")
    print(f"\nOctets en DOUBLON (objets identiques répétés) : {mo(dup_bytes)}")
    print(f"Flux NON compressés : {uncompressed}  ({mo(unc_bytes)})")
    print("\n10 plus gros objets :")
    for n, kind, dim in sorted(biggest, reverse=True)[:10]:
        print(f"  {mo(n):>10s}  {kind}  {dim if dim != 'x' else ''}")
    imgs = tot['image']
    print("\nDIAGNOSTIC :")
    if imgs > 0.4 * size: print("  → Le PDF est surtout fait d'IMAGES (pages capturées en bitmap) : « fix » les réencode en JPEG.")
    if dup_bytes > 0.2 * size: print("  → Beaucoup d'objets identiques répétés (polices/images dupliquées par fiche) : « fix » les fusionne.")
    if unc_bytes > 0.2 * size: print("  → Beaucoup de flux non compressés : « fix » les recompresse.")
    if tot['police'] > 0.5 * size and dup_bytes < 0.2 * size: print("  → Polices complètes différentes à chaque fiche : régénère le PDF avec des polices sous-ensemble (subset).")

def dedupe(pdf):
    canon = {}; remap = {}
    for obj in list(pdf.objects):
        if isinstance(obj, Stream):
            k = stream_key(obj)
            if k in canon: remap[obj.objgen] = canon[k]
            else: canon[k] = obj
    if not remap: return 0
    def fix(container):
        if isinstance(container, (Dictionary, Stream)) or hasattr(container, 'keys'):
            for key in list(container.keys()):
                try: v = container[key]
                except Exception: continue
                if getattr(v, 'is_indirect', False) and v.objgen in remap: container[key] = remap[v.objgen]
        elif isinstance(container, Array):
            for i in range(len(container)):
                v = container[i]
                if getattr(v, 'is_indirect', False) and v.objgen in remap: container[i] = remap[v.objgen]
    for obj in list(pdf.objects):
        if isinstance(obj, (Dictionary, Stream, Array)) or hasattr(obj, 'keys'): fix(obj)
    fix(pdf.Root); fix(pdf.trailer)
    return len(remap)

def shrink_images(pdf):
    from PIL import Image
    done = 0; saved = 0
    for obj in list(pdf.objects):
        if not isinstance(obj, Stream) or str(obj.get('/Subtype', '')) != '/Image': continue
        raw = obj.read_raw_bytes()
        if len(raw) < BIG_IMG or '/SMask' in obj or '/Mask' in obj or obj.get('/ImageMask', False): continue
        if str(obj.get('/Filter', '')) == '/DCTDecode' and max(int(obj.Width), int(obj.Height)) <= IMG_MAX_PX: continue
        try:
            im = PdfImage(obj).as_pil_image()
            if im.mode not in ('RGB', 'L'): im = im.convert('RGB')
            if max(im.size) > IMG_MAX_PX:
                r = IMG_MAX_PX / max(im.size); im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.LANCZOS)
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality=JPEG_Q, optimize=True)
            data = buf.getvalue()
            if len(data) >= len(raw): continue
            obj.write(data, filter=Name.DCTDecode)
            obj.Width, obj.Height = im.width, im.height
            obj.ColorSpace = Name.DeviceRGB if im.mode == 'RGB' else Name.DeviceGray
            obj.BitsPerComponent = 8
            for k in ('/DecodeParms', '/Decode', '/Predictor'):
                if k in obj: del obj[k]
            done += 1; saved += len(raw) - len(data)
        except Exception as e:
            print("  (image ignorée :", e, ")")
    return done, saved

def fix(src, dst=None):
    dst = dst or os.path.splitext(src)[0] + '-allege.pdf'
    before = os.path.getsize(src)
    pdf = pikepdf.open(src)
    n_pages = len(pdf.pages)
    print(f"Avant : {mo(before)}, {n_pages} pages")
    nd = dedupe(pdf);              print(f"  objets identiques fusionnés : {nd}")
    ni, sv = shrink_images(pdf);   print(f"  images réencodées : {ni} (−{mo(sv)})")
    pdf.remove_unreferenced_resources()
    pdf.save(dst, compress_streams=True, recompress_flate=True,
             object_stream_mode=pikepdf.ObjectStreamMode.generate, linearize=False)
    pdf.close()
    chk = pikepdf.open(dst)
    if len(chk.pages) != n_pages:
        os.remove(dst); sys.exit(f"ERREUR : le nombre de pages a changé ({n_pages} → {len(chk.pages)}). Fichier supprimé.")
    after = os.path.getsize(dst)
    print(f"Après : {mo(after)} (−{100*(1-after/before):.0f} %) → {dst}")
    if after > 60 * 1048576: print("⚠ Toujours > 60 Mo : le dépôt sera refusé. Lance « diag » sur le résultat pour voir ce qui pèse.")
    else: print("✓ Redépose ce fichier via admin-upload-readyfiche-pdfs.html (même nom, avec le .meta.json existant).")

if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[1] not in ('diag', 'fix'): sys.exit(__doc__)
    (diag if sys.argv[1] == 'diag' else fix)(*sys.argv[2:4 if sys.argv[1] == 'fix' else 3])
