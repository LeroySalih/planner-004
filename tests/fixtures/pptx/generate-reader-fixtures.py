#!/usr/bin/env python3
"""Make the reader-2 test presentations (tests/fixtures/pptx/reader-2/).

Each file sets one kind of formatting at one level of PowerPoint's
inheritance chain (slide master, layout, slide) and leaves the rest at the
default, so tests/pptx/effective-format.check.ts can check the effective value
the reader reports and where it says the value comes from. No pupil files:
everything starts from python-pptx's own blank template, then the XML is
edited with lxml where python-pptx has no API (txStyles, anchors, footer
placeholders, fields, theme colours).

Needs python-pptx (pip install python-pptx). Run from the repository root:
  python3 tests/fixtures/pptx/generate-reader-fixtures.py
"""

import copy
import os
import re

from lxml import etree
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.util import Cm, Pt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reader-2")

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
NS = {"a": A, "p": P}


def q(tag):
    prefix, name = tag.split(":")
    return "{%s}%s" % (NS[prefix], name)


def sub(parent, tag, **attrs):
    el = etree.SubElement(parent, q(tag))
    for k, v in attrs.items():
        el.set(k, v)
    return el


def xp(el, xpath):
    # python-pptx's elements override xpath() with their own namespace map.
    return etree._Element.xpath(el, xpath, namespaces=NS)


def first(el, xpath):
    found = xp(el, xpath)
    return found[0] if found else None


# ------------------------------------------------------------- the template

def layout(prs, name):
    for lay in prs.slide_layouts:
        if lay.name == name:
            return lay
    raise KeyError(name)


def ph_shape(root, ph_type):
    return first(root, ".//p:sp[p:nvSpPr/p:nvPr/p:ph[@type='%s']]" % ph_type)


def title_lvl1(prs):
    return first(prs.slide_master._element, "p:txStyles/p:titleStyle/a:lvl1pPr")


def strip_title_formatting(prs):
    """No alignment or anchor anywhere for the title: master, layouts, defaults."""
    master = prs.slide_master._element
    title_lvl1(prs).attrib.pop("algn", None)
    for root in [master] + [lay._element for lay in prs.slide_layouts]:
        for t in ("title", "ctrTitle"):
            sp = ph_shape(root, t)
            if sp is None:
                continue
            body_pr = first(sp, "p:txBody/a:bodyPr")
            if body_pr is not None:
                body_pr.attrib.pop("anchor", None)
            for lvl in xp(sp, "p:txBody/a:lstStyle/*"):
                lvl.attrib.pop("algn", None)
    for lvl in xp(prs._element, "p:defaultTextStyle/*"):
        lvl.attrib.pop("algn", None)


def set_master_title(prs, algn=None, anchor=None):
    if algn:
        title_lvl1(prs).set("algn", algn)
    if anchor:
        first(ph_shape(prs.slide_master._element, "title"), "p:txBody/a:bodyPr").set("anchor", anchor)


def set_fill(sp_pr, hex_value, alpha=None):
    """A solid fill in spPr, placed where the schema wants it (after the geometry)."""
    for old in xp(sp_pr, "a:solidFill|a:noFill|a:gradFill|a:blipFill|a:pattFill"):
        sp_pr.remove(old)
    fill = etree.Element(q("a:solidFill"))
    clr = sub(fill, "a:srgbClr", val=hex_value)
    if alpha is not None:
        sub(clr, "a:alpha", val=str(alpha))
    geom = first(sp_pr, "a:prstGeom|a:custGeom")
    if geom is not None:
        geom.addnext(fill)
    else:
        sp_pr.append(fill)
    return fill


def footer_lvl1(sp):
    return first(sp, "p:txBody/a:lstStyle/a:lvl1pPr")


def set_master_footer_size(prs, size_hundredths):
    for t in ("dt", "ftr", "sldNum"):
        defrpr = first(footer_lvl1(ph_shape(prs.slide_master._element, t)), "a:defRPr")
        defrpr.set("sz", str(size_hundredths))


# ------------------------------------------------------------- slides

def add_title_slide(prs, layout_name, title):
    slide = prs.slides.add_slide(layout(prs, layout_name))
    slide.shapes.title.text = title
    return slide


def add_footers(slide, email="info@example.org", date_type="datetime4", lang="en-GB",
                date_text="14 November 2026", run_size=None):
    """Copy the layout's date, footer and slide number placeholders onto the
    slide (empty spPr, so the position is inherited) with text in them."""
    tree = slide.shapes._spTree
    lay = slide.slide_layout._element
    for t in ("dt", "ftr", "sldNum"):
        src = ph_shape(lay, t)
        sp = copy.deepcopy(src)
        sp_pr = first(sp, "p:spPr")
        for c in list(sp_pr):
            sp_pr.remove(c)
        tx = first(sp, "p:txBody")
        for c in list(tx):
            if c.tag != q("a:bodyPr"):
                tx.remove(c)
        sub(tx, "a:lstStyle")
        p = sub(tx, "a:p")
        if t == "ftr":
            r = sub(p, "a:r")
            rpr = sub(r, "a:rPr", lang=lang)
            sub(r, "a:t").text = email
        else:
            fld_type = date_type if t == "dt" else "slidenum"
            fld = sub(p, "a:fld", id="{00000000-0000-0000-0000-00000000000%d}" % (1 if t == "dt" else 2), type=fld_type)
            rpr = sub(fld, "a:rPr", lang=lang)
            sub(fld, "a:t").text = date_text if t == "dt" else "‹#›"
        if run_size is not None and t in ("dt", "ftr"):
            rpr.set("sz", str(run_size))
        sub(p, "a:endParaRPr", lang=lang)
        # A fresh id that no other shape on the slide has.
        ids = [int(x) for x in xp(tree, ".//p:cNvPr/@id")]
        first(sp, ".//p:cNvPr").set("id", str(max(ids) + 1))
        tree.append(sp)


def save(prs, name):
    os.makedirs(OUT, exist_ok=True)
    prs.save(os.path.join(OUT, name))
    print("wrote", name)


# ------------------------------------------------------------- the files

def title_master_only():
    """Title centred and anchored middle on the master only: layouts and
    slides inherit."""
    prs = Presentation()
    strip_title_formatting(prs)
    set_master_title(prs, algn="ctr", anchor="ctr")
    add_title_slide(prs, "Title Only", "Welcome to the kiosk")
    add_title_slide(prs, "Title and Content", "Opening times")
    save(prs, "title-master-only.pptx")


def title_master_lststyle():
    """Alignment, size and bold set in the master title placeholder's own
    list style (not the master's text styles): layouts and slides inherit."""
    prs = Presentation()
    strip_title_formatting(prs)
    sp = ph_shape(prs.slide_master._element, "title")
    lst = first(sp, "p:txBody/a:lstStyle")
    lvl = sub(lst, "a:lvl1pPr", algn="ctr")
    sub(lvl, "a:defRPr", sz="4000", b="1")
    add_title_slide(prs, "Title Only", "Welcome to the kiosk")
    save(prs, "title-master-lststyle.pptx")


def title_default():
    """Nothing set for the title's alignment or anchor anywhere: PowerPoint's
    defaults (left, top) apply."""
    prs = Presentation()
    strip_title_formatting(prs)
    add_title_slide(prs, "Title Only", "Welcome to the kiosk")
    add_title_slide(prs, "Title and Content", "Opening times")
    save(prs, "title-default.pptx")


def title_slide_override():
    """Centred/middle on the master; slide 2 sets right/bottom on itself."""
    prs = Presentation()
    strip_title_formatting(prs)
    set_master_title(prs, algn="ctr", anchor="ctr")
    add_title_slide(prs, "Title Only", "Welcome to the kiosk")
    slide = add_title_slide(prs, "Title Only", "Opening times")
    title = slide.shapes.title._element
    first(title, "p:txBody/a:bodyPr").set("anchor", "b")
    p = first(title, "p:txBody/a:p")
    ppr = etree.Element(q("a:pPr"), algn="r")
    p.insert(0, ppr)
    save(prs, "title-slide-override.pptx")


def footer_master_20():
    """Date, footer and slide number text at 20 pt on the master only."""
    prs = Presentation()
    set_master_footer_size(prs, 2000)
    for name in ("Welcome", "Opening times"):
        add_footers(add_title_slide(prs, "Title Only", name))
    save(prs, "footer-master-20.pptx")


def footer_slide_20():
    """Master left at 12 pt; slide 2's date and footer runs set 20 pt."""
    prs = Presentation()
    add_footers(add_title_slide(prs, "Title Only", "Welcome"))
    add_footers(add_title_slide(prs, "Title Only", "Opening times"), run_size=2000)
    save(prs, "footer-slide-20.pptx")


def shape_fills():
    """Text boxes and autoshapes with each kind of fill, and text aligned and
    anchored on the shape itself."""
    prs = Presentation()
    slide = add_title_slide(prs, "Title Only", "Shapes")
    shapes = slide.shapes

    yellow = shapes.add_textbox(Cm(1), Cm(4), Cm(8), Cm(2))
    yellow.name = "Yellow note"
    yellow.text_frame.text = "Pale yellow box"
    set_fill(yellow._element.spPr, "FFF2CC")
    body_pr = first(yellow._element, "p:txBody/a:bodyPr")
    body_pr.set("anchor", "ctr")
    first(yellow._element, "p:txBody/a:p").insert(0, etree.Element(q("a:pPr"), algn="ctr"))

    plain = shapes.add_textbox(Cm(10), Cm(4), Cm(8), Cm(2))
    plain.name = "Plain note"
    plain.text_frame.text = "No fill"

    styled = shapes.add_shape(MSO_SHAPE.RECTANGLE, Cm(1), Cm(7), Cm(8), Cm(2))
    styled.name = "Theme rectangle"
    styled.text_frame.text = "Fill from the shape style"

    see_through = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Cm(10), Cm(7), Cm(8), Cm(2))
    see_through.name = "Half see-through"
    see_through.text_frame.text = "Half transparent"
    set_fill(see_through._element.spPr, "00B050", alpha=50000)

    empty = shapes.add_shape(MSO_SHAPE.OVAL, Cm(1), Cm(10), Cm(4), Cm(2))
    empty.name = "Outline only"
    sp_pr = empty._element.spPr
    first(sp_pr, "a:prstGeom").addnext(etree.Element(q("a:noFill")))

    graded = shapes.add_shape(MSO_SHAPE.RECTANGLE, Cm(10), Cm(10), Cm(8), Cm(2))
    graded.name = "Gradient box"
    graded.fill.gradient()
    save(prs, "shape-fills.pptx")


def title_fill_master():
    """The master's title placeholder filled dark purple: layouts and slides
    inherit it."""
    prs = Presentation()
    sp_pr = first(ph_shape(prs.slide_master._element, "title"), "p:spPr")
    set_fill(sp_pr, "7030A0")
    add_title_slide(prs, "Title Only", "Welcome")
    add_title_slide(prs, "Title and Content", "Opening times")
    save(prs, "title-fill-master.pptx")


def date_field():
    """A datetime4 date field in English (UK)."""
    prs = Presentation()
    add_footers(add_title_slide(prs, "Title Only", "Welcome"), date_type="datetime4", lang="en-GB")
    save(prs, "date-field.pptx")


def unknown_colour():
    """A theme without accent6, and a text box filled and coloured with it:
    the colour cannot be resolved."""
    prs = Presentation()
    theme = prs.slide_master.part.part_related_by(RT.THEME)
    blob = theme.blob.decode("utf-8")
    blob, n = re.subn(r"<a:accent6>.*?</a:accent6>", "", blob, flags=re.S)
    assert n == 1, "the template theme has no accent6"
    theme._blob = blob.encode("utf-8")
    slide = add_title_slide(prs, "Title Only", "Missing colour")
    box = slide.shapes.add_textbox(Cm(1), Cm(4), Cm(10), Cm(2))
    box.name = "Accent six box"
    box.text_frame.text = "Accent 6 text"
    sp_pr = box._element.spPr
    fill = etree.Element(q("a:solidFill"))
    sub(fill, "a:schemeClr", val="accent6")
    first(sp_pr, "a:prstGeom").addnext(fill)
    r = first(box._element, ".//a:r")
    rpr = first(r, "a:rPr")
    if rpr is None:
        rpr = etree.Element(q("a:rPr"), lang="en-GB")
        r.insert(0, rpr)
    sub(sub(rpr, "a:solidFill"), "a:schemeClr", val="accent6")
    save(prs, "unknown-colour.pptx")


if __name__ == "__main__":
    title_master_only()
    title_master_lststyle()
    title_default()
    title_slide_override()
    footer_master_20()
    footer_slide_20()
    shape_fills()
    title_fill_master()
    date_field()
    unknown_colour()
