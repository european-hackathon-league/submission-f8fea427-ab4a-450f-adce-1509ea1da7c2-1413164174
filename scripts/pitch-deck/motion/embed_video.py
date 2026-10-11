from pathlib import Path
import zipfile
from lxml import etree as ET

ROOT = Path(__file__).resolve().parents[3]
BUILD = ROOT / '.codex/presentation-build'
SOURCE = BUILD / 'draft-v2.pptx'
TARGET = BUILD / 'animated-draft.pptx'
VIDEO = ROOT / 'output/video/FWD_BMW_1Series_Intro.mp4'
POSTER = BUILD / 'motion/poses/pose-04.png'
NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main', 'a': 'http://schemas.openxmlformats.org/drawingml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main'}
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'

with zipfile.ZipFile(SOURCE) as package:
    files = {item.filename: package.read(item.filename) for item in package.infolist()}
slide = ET.fromstring(files['ppt/slides/slide1.xml'])
shape_id = max(int(value) for value in slide.xpath('//@id') if value.isdigit()) + 1
movie = ET.fromstring(f'''<p:pic xmlns:p="{NS['p']}" xmlns:a="{NS['a']}" xmlns:r="{NS['r']}" xmlns:p14="{NS['p14']}">
 <p:nvPicPr><p:cNvPr id="{shape_id}" name="FWD opening film — autoplay, 5 seconds" descr="Five-second car rotation, ending on the title cover. Editable title and series layers remain underneath."><a:hlinkClick action="ppaction://media"/></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr><a:videoFile r:link="rIdFwdVideo"/><p:extLst><p:ext uri="{{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}}"><p14:media r:embed="rIdFwdMedia"/></p:ext></p:extLst></p:nvPr></p:nvPicPr>
 <p:blipFill><a:blip r:embed="rIdFwdPoster"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
 <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr>
</p:pic>'''.encode())
slide.find('p:cSld/p:spTree', NS).append(movie)
for old in slide.findall('p:timing', NS):
    slide.remove(old)
timing = ET.fromstring(Path(__file__).with_name('autoplay-timing.xml').read_bytes())
for target in timing.findall('.//p:spTgt', NS):
    target.set('spid', str(shape_id))
extension = slide.find('p:extLst', NS)
if extension is not None:
    slide.insert(list(slide).index(extension), timing)
else:
    slide.append(timing)
files['ppt/slides/slide1.xml'] = ET.tostring(slide, xml_declaration=True, encoding='UTF-8', standalone=True)
rels = ET.fromstring(files['ppt/slides/_rels/slide1.xml.rels'])
for rid, kind, target in [('rIdFwdVideo', NS['r'] + '/video', '../media/fwd-intro.mp4'), ('rIdFwdMedia', 'http://schemas.microsoft.com/office/2007/relationships/media', '../media/fwd-intro.mp4'), ('rIdFwdPoster', NS['r'] + '/image', '../media/fwd-intro-poster.png')]:
    ET.SubElement(rels, f'{{{REL}}}Relationship', Id=rid, Type=kind, Target=target)
files['ppt/slides/_rels/slide1.xml.rels'] = ET.tostring(rels, xml_declaration=True, encoding='UTF-8', standalone=True)
types = ET.fromstring(files['[Content_Types].xml'])
if not types.xpath('ct:Default[@Extension="mp4"]', namespaces={'ct': CT}):
    ET.SubElement(types, f'{{{CT}}}Default', Extension='mp4', ContentType='video/mp4')
files['[Content_Types].xml'] = ET.tostring(types, xml_declaration=True, encoding='UTF-8', standalone=True)
files['ppt/media/fwd-intro.mp4'] = VIDEO.read_bytes()
files['ppt/media/fwd-intro-poster.png'] = POSTER.read_bytes()
with zipfile.ZipFile(TARGET, 'w', zipfile.ZIP_DEFLATED) as package:
    for name, data in files.items():
        package.writestr(name, data)
print(TARGET)
