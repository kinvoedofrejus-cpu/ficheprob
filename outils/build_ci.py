#!/usr/bin/env python3
"""Génère les PDF « Fiches Prêtes » de CI dans la mise en page de l'exemple
(Fiches_Francais_Lecons_1_a_20) : un PDF fusionné par matière + .meta.json
(pageStarts + parSlot) à déposer via admin-upload-readyfiche-pdfs.html.

Usage : python3 build_ci.py ci.json out_dir [--only cle1,cle2] [--limit N]
"""
import json, re, sys, os
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FD = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('Se', FD + 'DejaVuSerif.ttf'))
pdfmetrics.registerFont(TTFont('SeB', FD + 'DejaVuSerif-Bold.ttf'))
pdfmetrics.registerFont(TTFont('SeI', FD + 'DejaVuSerif-Italic.ttf'))
pdfmetrics.registerFont(TTFont('SeBI', FD + 'DejaVuSerif-BoldItalic.ttf'))
sw = pdfmetrics.stringWidth

PW, PH = 595.276, 841.89
INK = (0.102, 0.133, 0.2196)
LINE = (0.0667, 0.0667, 0.0667)
GRAY = (0.937, 0.937, 0.937)
XL, XR = 38.0, 557.3
XD = 432.6                      # séparateur Consignes | Résultats
TOP_CONT = 42.0                 # haut du tableau sur les pages de suite
BOTTOM = 778.8                  # bas utile du tableau
FS = 9.2                        # corps du tableau
LEAD = 12.6                     # interligne
PARA = 3.0                      # espace entre puces
PADX = 9.0                      # marge interne gauche (47 - 38)
PADT, PADB = 5.0, 5.5

# ------------------------------------------------------------------ texte
def wrap(text, font, size, width):
    words = text.split()
    lines, cur = [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if sw(t, font, size) <= width or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines or ['']

MARK = re.compile(r'^(Je fais|Nous faisons|Tu fais)\s*:\s*(.*)$')
END = tuple('.?!:;»)…"”')

def san(t):
    return re.sub(r'\*{2,}', '', re.sub(r'</?u>', '', str(t or '')))

def clean_lines(text):
    raw = [san(l).strip() for l in str(text or '').replace('\r', '').split('\n')]
    raw = [l for l in raw if l]
    out = []
    for l in raw:
        cont_dash = bool(re.match(r'^[-–]\s*[a-zà-ÿ]', l)) and out and out[-1].endswith('-')
        if out and not MARK.match(l) and (cont_dash or (not re.match(r'^[-–•*]', l) and l[0].islower())) \
                and not out[-1].endswith(END):
            out[-1] = out[-1] + ' ' + l
        else:
            out.append(l)
    return out

def norm(s):
    return re.sub(r'[\s\W_]+', '', s.lower())

def strip_label(lines, label):
    """Retire « Label : » en tête de la 1re ligne (le libellé est déjà affiché)."""
    if not lines or not label: return lines
    first = lines[0]
    m = re.match(r'^(.{0,160}?)\s:\s*(.*)$', first)
    if m and norm(m.group(1)) == norm(label):
        rest = m.group(2).strip()
        return ([rest] if rest else []) + lines[1:]
    if norm(first) == norm(label):
        return lines[1:]
    return lines

def line_item(l):
    """(style, texte) d'une ligne de puce."""
    if re.match(r'^(NB|N\.B)\s*[:.]', l, re.I):
        return ('note', l)
    if re.match(r'^[-–]\s*', l):
        return ('sub', re.sub(r'^[-–]\s*', '', l))
    if l.startswith('•') or l.startswith('*'):
        return ('bullet', l.lstrip('•* ').strip())
    return ('bullet', l)

# ---------------------------------------------------------- structuration
def build_blocks(fiche):
    """-> liste de ('band', texte) / ('row', [(style,texte)...], resultats)."""
    blocks = []
    for p in fiche['phases']:
        pname = (p.get('phase') or '').strip()
        ptitre = (p.get('titre') or '').strip()
        band = pname.upper() + (' : ' + ptitre if ptitre else '')
        blocks.append(('band', band))
        retour = norm(pname).startswith('retour')
        for it in p['items']:
            label = san(it.get('label')).strip()
            res = san(it.get('resultats')).strip()
            lines = clean_lines(it.get('consignes'))
            lines = strip_label(lines, label)
            has_mark = any(MARK.match(l) for l in lines)
            show_label = bool(label) and norm(label) != norm(pname)
            rows = []          # chaque row = liste d'items (style, texte)

            def lead_rows(ls, with_label):
                if not ls and not with_label: return
                r = []
                if with_label: r.append(('label', label))
                if len(ls) == 1:
                    r.append(('plain', ls[0]))
                else:
                    r += [line_item(x) for x in ls]
                rows.append(r)

            if has_mark and not retour:
                if show_label: blocks.append(('band', label.upper()))
                lead, rest = [], []
                for l in lines:
                    (rest if (rest or MARK.match(l)) else lead).append(l)
                lead_rows(lead, False)
            else:
                lead, rest = [], []
                for l in lines:
                    (rest if (rest or MARK.match(l)) else lead).append(l)
                if show_label or lead:
                    lead_rows(lead, show_label)
                elif not rest and res:
                    rows.append([])
            cur = None
            for l in rest:
                m = MARK.match(l)
                if m:
                    cur = [('label', m.group(1))]
                    rows.append(cur)
                    if m.group(2).strip(): cur.append(line_item(m.group(2).strip()))
                else:
                    cur.append(line_item(l))
            if not rows and not (show_label and not has_mark):
                if res: rows.append([])
                else: continue
            for i, r in enumerate(rows):
                blocks.append(('row', r, res if i == 0 else ''))
    # fusionne bandeaux consécutifs identiques / bandeau final orphelin
    out = []
    for b in blocks:
        if b[0] == 'band' and out and out[-1][0] == 'band' and out[-1][1] == b[1]:
            continue
        out.append(b)
    return out

# --------------------------------------------------------------- mesures
LW = XD - XL - 2 * PADX          # largeur texte colonne gauche
BULLET_X, BULLET_IND = 0.0, 9.0   # '• ' : texte à +9
SUB_X, SUB_IND = 11.0, 10.0       # '– '

def layout_row(items):
    """-> liste de 'visual lines': (dy_before, font, x_off, text, underline, kind)"""
    vls = []
    first = True
    for style, text in items:
        if style == 'label':
            ls_ = wrap(text, 'SeBI', FS, LW)
            for j, t in enumerate(ls_):
                vls.append(dict(font='SeBI', x=0, text=t, ul=True, gap=0, kind='label' if j == len(ls_) - 1 else 'labelc', cont=j > 0))
        elif style == 'plain':
            for j, t in enumerate(wrap(text, 'Se', FS, LW)):
                vls.append(dict(font='Se', x=0, text=t, ul=False, gap=0, kind='plain', cont=j > 0))
        else:
            font = 'SeI' if style == 'note' else 'Se'
            if style == 'sub':
                x0, ind, mark = SUB_X, SUB_IND, '– '
            else:
                x0, ind, mark = BULLET_X, BULLET_IND, '• '
            ls = wrap(text, font, FS, LW - x0 - ind)
            for j, t in enumerate(ls):
                vls.append(dict(font=font, x=x0 + (ind if j else 0), text=(t if j else mark + t), ul=False,
                                gap=0, kind=style, cont=j > 0))
        first = False
    # espacement vertical
    prev = None
    for v in vls:
        if prev is None:
            v['dy'] = FS * 0.9
        elif v.get('cont'):
            v['dy'] = LEAD
        elif prev['kind'] == 'label':
            v['dy'] = LEAD + 0.6
        elif prev['kind'] == 'labelc':
            v['dy'] = LEAD
        else:
            v['dy'] = LEAD + PARA
        prev = v
    return vls

def vls_height(vls):
    if not vls: return 0
    return vls[0]['dy'] + sum(v['dy'] for v in vls[1:]) + 3.0

# -------------------------------------------------------------- dessin
class Doc:
    def __init__(self, path):
        self.c = canvas.Canvas(path, pagesize=(PW, PH))
        self.c.setTitle('Fiches prêtes')
        self.page_no = 0
        self.fiche_pages = []   # pages (0-based) de début
        self.par_slot = None
        self.pending_footer = []  # (page_index_in_fiche) gérés par fiche

    # coordonnées « haut-bas » -> reportlab
    def Y(self, y): return PH - y

    def line(self, x0, y0, x1, y1, w, color=LINE):
        c = self.c
        c.setStrokeColorRGB(*color); c.setLineWidth(w)
        c.line(x0, self.Y(y0), x1, self.Y(y1))

    def text(self, x, ybase, s, font, size, color=INK, align='l'):
        c = self.c
        c.setFillColorRGB(*color); c.setFont(font, size)
        if align == 'c': c.drawCentredString(x, self.Y(ybase), s)
        elif align == 'r': c.drawRightString(x, self.Y(ybase), s)
        else: c.drawString(x, self.Y(ybase), s)

    def label_value(self, x, ybase, label, value, size, lab_font='SeB', val_font='Se', underline=True):
        """label souligné gras + valeur normale; renvoie x de fin."""
        self.text(x, ybase, label, lab_font, size)
        lw = sw(label, lab_font, size)
        if underline:
            self.line(x, ybase + 1.7, x + lw, ybase + 1.7, 0.6, INK)
        if value:
            self.text(x + lw + sw(' ', val_font, size), ybase, value, val_font, size)
        return x + lw + sw(' ', val_font, size) + (sw(value, val_font, size) if value else 0)

    def frame(self):
        c = self.c
        c.setStrokeColorRGB(*LINE); c.setLineWidth(2.4)
        c.rect(22.0, self.Y(809.9), 573.3 - 22.0, 809.9 - 22.0, stroke=1, fill=0)

    def new_page(self):
        if self.page_no: self.c.showPage()
        self.page_no += 1
        self.frame()

    def footer(self, n, total):
        self.text(PW / 2, 824.5, f'Page {n}/{total}', 'Se', 7.5, (0.333, 0.333, 0.333), 'c')

def draw_vlines(d, y0, y1, divider):
    d.line(XL, y0, XL, y1, 2.2); d.line(XR, y0, XR, y1, 2.2)
    if divider: d.line(XD, y0, XD, y1, 2.2)

def draw_row_text(d, vls, ytop, res_text, show_res, padt=PADT):
    y = ytop + padt
    for v in vls:
        y += v['dy']
        # position de base: dy compte depuis la ligne précédente
        d.text(XL + PADX + v['x'], y - 1.5 if v['kind'] != 'label' else y - 1.5, v['text'], v['font'], FS)
        if v['ul']:
            w = sw(v['text'], v['font'], FS)
            d.line(XL + PADX + v['x'], y + 0.2, XL + PADX + v['x'] + w, y + 0.2, 0.6, INK)
    if show_res and res_text:
        yy = ytop + padt + 8.5
        for ln in res_wrap(res_text):
            d.text((XD + XR) / 2, yy + 2, ln, 'Se', 8.8, INK, 'c')
            yy += 12.2

RW = XR - XD - 14
def res_wrap(t):
    out = []
    for para in str(t).split('\n'):
        para = para.strip()
        if para: out += wrap(para, 'Se', 8.8, RW)
    return out

def res_height(t):
    return len(res_wrap(t)) * 12.2 + 6 if t else 0

def draw_fiche(d, fiche, idx, matiere_label, fiche_pages=1):
    h = {k: san(v) for k, v in fiche['header'].items()}
    pages_local = []        # numéros de pages locales dessinées
    first_page_abs = d.page_no
    d.new_page()
    local_start = d.page_no

    fn = (h.get('fn') or '').strip() or str(idx)
    d.text(XL, 51.0, 'Fiche N°', 'SeB', 8.5); d.text(XL + sw('Fiche N° ', 'SeB', 8.5), 51.0, fn, 'Se', 8.5)
    cours = (h.get('cours') or 'CI')
    cw = sw(cours, 'Se', 8.5)
    d.text(XR, 51.0, cours, 'Se', 8.5, INK, 'r')
    d.text(XR - cw - sw(' ', 'Se', 8.5), 51.0, 'COURS:', 'SeB', 8.5, INK, 'r')

    # titre dans un encadré
    title = 'FICHE DE PRÉPARATION DE ' + (h.get('matiere') or matiere_label).upper()
    size = 13.4
    while sw(title, 'SeB', size) > (XR - XL - 24) and size > 9.5: size -= 0.3
    tl = wrap(title, 'SeB', size, XR - XL - 24)
    box_h = max(31.4, 12 + len(tl) * (size + 3.4))
    d.line(XL, 59.6, XR, 59.6, 1.3); d.line(XL, 59.6 + box_h, XR, 59.6 + box_h, 1.3)
    d.line(XL, 59.6, XL, 59.6 + box_h, 1.3); d.line(XR, 59.6, XR, 59.6 + box_h, 1.3)
    yy = 59.6 + (box_h - len(tl) * (size + 3.4)) / 2 + size + 0.6
    for t in tl:
        d.text((XL + XR) / 2, yy, t, 'SeB', size, INK, 'c'); yy += size + 3.4

    y = 59.6 + box_h
    # emplacement « Par : » (laissé vide : le nom est posé par l'appli)
    par_y = y + 6.4
    d.par_slot = dict(x=round(XR - 4, 1), y=round(par_y, 1), width=4, height=13)
    y = par_y + 13 + 3

    # séance / durée
    parts = []
    if (h.get('seanceNumero') or '').strip(): parts.append(('SÉANCE N°:', h['seanceNumero'].strip()))
    if (h.get('duree') or '').strip(): parts.append(('Durée:', h['duree'].strip()))
    if parts:
        x = XL; yb = y + 12.2
        for i, (lab, val) in enumerate(parts):
            x = d.label_value(x, yb, lab, val, 10.5)
            x += 14
        y += 15.0
    y += 2.5

    # boîte grise du titre de la séance
    titre = (h.get('titre') or h.get('theme') or '').strip()
    if titre:
        tsize = 10.0
        tls = wrap(titre, 'SeB', tsize, XR - XL - 24)
        bh = max(23.5, 10 + len(tls) * 13.2)
        c = d.c
        c.setFillColorRGB(*GRAY); c.setStrokeColorRGB(0.6, 0.6, 0.6); c.setLineWidth(0.8)
        c.roundRect(XL, d.Y(y + bh), XR - XL, bh, 6, stroke=1, fill=1)
        yy = y + (bh - len(tls) * 13.2) / 2 + 10.0
        for t in tls:
            d.text((XL + XR) / 2, yy, t, 'SeB', tsize, INK, 'c'); yy += 13.2
        y += bh + 6.5

    def info(label, value):
        nonlocal y
        value = (value or '').strip()
        if not value: return
        lines = [l.strip() for l in value.replace('\r', '').split('\n') if l.strip()]
        lw_ = sw(label + ' ', 'SeB', 9.6)
        if len(lines) == 1 and sw(lines[0], 'Se', 9.6) <= XR - XL - lw_:
            d.label_value(XL, y + 9.6, label, lines[0], 9.6)
            y += 15.4
            return
        flat = ' '.join(lines)
        if len(lines) == 1:
            ws = flat.split(); first = ''
            # première ligne à côté du label
            avail = XR - XL - lw_
            while ws and sw((first + ' ' + ws[0]).strip(), 'Se', 9.6) <= avail:
                first = (first + ' ' + ws.pop(0)).strip()
            d.label_value(XL, y + 9.6, label, first, 9.6)
            y += 12.6
            for t in wrap(' '.join(ws), 'Se', 9.6, XR - XL):
                d.text(XL, y + 9.6, t, 'Se', 9.6); y += 12.6
            y += 2.8
        else:
            d.label_value(XL, y + 9.6, label, '', 9.6)
            y += 13.0
            for l in lines:
                l = l.lstrip('•-– ').strip()
                for j, t in enumerate(wrap(l, 'Se', 9.6, XR - XL - 6 - 9)):
                    d.text(XL + 6 + (9 if j else 0), y + 9.6, ('• ' + t) if j == 0 else t, 'Se', 9.6)
                    y += 12.6
                y += 0.4
            y += 2.4

    info('Compétence disciplinaire:', h.get('competenceDisciplinaire'))
    info('Connaissances et techniques:', h.get('connaissancesTechniques'))
    info('Matériel:', h.get('materiel'))

    # DÉROULEMENT
    y += 14
    d.text((XL + XR) / 2, y + 17, 'DÉROULEMENT', 'SeBI', 23, INK, 'c')
    y += 29.6 + 4.5 + 3

    # en-tête du tableau
    hh = 36.0
    c = d.c
    c.setFillColorRGB(*GRAY); c.rect(XL, d.Y(y + hh), XR - XL, hh, stroke=0, fill=1)
    d.line(XL, y, XR, y, 2.2); d.line(XL, y + hh, XR, y + hh, 2.2)
    draw_vlines(d, y, y + hh, True)
    d.text((XL + XD) / 2, y + 21.2, 'CONSIGNES', 'SeBI', 9, INK, 'c')
    d.text((XD + XR) / 2, y + 15.0, 'RÉSULTATS', 'SeBI', 9, INK, 'c')
    d.text((XD + XR) / 2, y + 27.1, 'ATTENDUS', 'SeBI', 9, INK, 'c')
    y += hh

    blocks = build_blocks(fiche)
    queue = []
    for bl_ in blocks:
        if bl_[0] == 'band': queue.append(bl_)
        else: queue.append(('rowv', layout_row(bl_[1]), bl_[2], False))

    cur_y = y
    n_local = 1
    d.footer(1, fiche_pages)

    topline = [False]

    def break_page(next_is_row):
        nonlocal cur_y, n_local
        # coupure entre deux lignes du tableau : on ferme proprement la page (trait épais)
        # puis on rouvre le tableau en haut de la page suivante
        d.line(XL, cur_y, XR, cur_y, 2.2)
        n_local += 1
        d.new_page()
        d.footer(n_local, fiche_pages)
        cur_y = TOP_CONT
        topline[0] = True

    def top_rule(top):
        if topline[0]:
            d.line(XL, top, XR, top, 2.2); topline[0] = False
        elif top > TOP_CONT + 0.5:
            d.line(XL, top, XR, top, 1.3)

    i = 0
    while i < len(queue):
        b = queue[i]
        if b[0] == 'band':
            bl = wrap(b[1], 'SeBI', 9.2, XR - XL - 30)
            bh = 22.5 if len(bl) == 1 else 22.5 + (len(bl) - 1) * 12.4
            if cur_y + bh + 30 > BOTTOM:
                break_page(False)
            top = cur_y
            top_rule(top)
            d.line(XL, top + bh, XR, top + bh, 1.3)
            draw_vlines(d, top, top + bh, False)
            yy = top + (bh - len(bl) * 12.4) / 2 + 9.0
            for t in bl:
                d.text((XL + XR) / 2, yy, t, 'SeBI', 9.2, INK, 'c'); yy += 12.4
            cur_y = top + bh
            i += 1
            continue

        _, vls, res, cont = b
        padt = 3.5 if cont else PADT
        body = (vls_height(vls) - vls[0]['dy'] + FS * 0.9) if vls else 0
        total = max(body + padt + PADB - 3.0 + 3.0, res_height(res) + padt + PADB)
        avail = BOTTOM - cur_y
        if total <= avail:
            top = cur_y
            top_rule(top)
            draw_row_text(d, vls, top, res, True, padt)
            draw_vlines(d, top, top + total, True)
            d.line(XL, top + total, XR, top + total, 1.3)
            cur_y = top + total
            i += 1
            continue
        # coupe entre deux lignes
        used = padt; k = 0
        for k_, v in enumerate(vls):
            dy = FS * 0.9 if k_ == 0 else v['dy']
            if used + dy + 2.5 > avail: break
            used += dy; k = k_ + 1
        min_first = 2 if vls and vls[0]['kind'] in ('label', 'labelc') else 1
        res_ok = (not res) or (used >= res_height(res) + padt)
        at_top = cur_y <= TOP_CONT + 0.5
        ok = k >= min_first and k < len(vls) and res_ok and not (k >= 1 and vls[k - 1]['kind'] in ('label', 'labelc'))
        if not ok and at_top:           # rien ne passe mieux : coupe forcée en haut de page
            k = max(1, k); ok = k < len(vls)
        if ok:
            top = cur_y
            top_rule(top)
            draw_row_text(d, vls[:k], top, res, True, padt)
            draw_vlines(d, top, BOTTOM, True)
            n_local += 1
            d.new_page(); d.footer(n_local, fiche_pages)
            cur_y = TOP_CONT
            rest = [dict(v) for v in vls[k:]]
            rest[0]['dy'] = FS * 0.9
            queue[i] = ('rowv', rest, '', True)
            continue
        if at_top:                       # ligne unique plus haute qu'une page (ne devrait pas arriver)
            draw_row_text(d, vls, cur_y, res, True, padt)
            draw_vlines(d, cur_y, cur_y + total, True)
            cur_y += total; i += 1; continue
        break_page(True)

    # trait de fermeture épais
    d.line(XL, cur_y, XR, cur_y, 2.2)
    return local_start - 1, n_local

def build_matiere(key, entry, fiches_limit, out_dir):
    import io
    path = os.path.join(out_dir, 'CI', key + '.pdf')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fiches = entry['fiches'][:fiches_limit] if fiches_limit else entry['fiches']
    # passe à blanc : nombre de pages de chaque fiche (pour « Page n/N »)
    dry = Doc(io.BytesIO())
    counts = []
    for i, f in enumerate(fiches, 1):
        counts.append(draw_fiche(dry, f, i, entry['matiereLabel'], 99)[1])
    d = Doc(path)
    starts = []
    for i, f in enumerate(fiches, 1):
        st, n = draw_fiche(d, f, i, entry['matiereLabel'], counts[i - 1])
        assert n == counts[i - 1], (key, i, n, counts[i - 1])
        starts.append(st)
    d.c.save()
    meta = dict(pageStarts=starts, parSlot=d.par_slot, pxToPt=1, marginTopPt=0, marginLeftPt=0,
                pageHeightPt=PH, pageCount=d.page_no, layout='ci-2026-10')
    json.dump(meta, open(os.path.join(out_dir, 'CI', key + '.meta.json'), 'w'), ensure_ascii=False)
    return len(fiches), d.page_no, os.path.getsize(path)

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    only = None; limit = None
    if '--only' in sys.argv: only = sys.argv[sys.argv.index('--only') + 1].split(',')
    if '--limit' in sys.argv: limit = int(sys.argv[sys.argv.index('--limit') + 1])
    data = json.load(open(src))
    for key, entry in data.items():
        if only and key not in only: continue
        print(key, build_matiere(key, entry, limit, out), flush=True)
