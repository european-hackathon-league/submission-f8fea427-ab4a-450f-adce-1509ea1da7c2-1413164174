const INK = '#172131', MUTED = '#5B6B82';
function type(slide, value, x, y, width, height, size, color, bold = false) {
  const shape = slide.shapes.add({ geometry: 'textbox', position: { left: x, top: y, width, height }, fill: 'none', line: { fill: 'none', width: 0 } });
  shape.text = value;
  shape.text.style = { typeface: 'Calibri', fontSize: size, bold, color, alignment: 'left', verticalAlignment: 'top', wrap: 'none', autoFit: 'shrinkText', insets: 0 };
  return shape;
}

export function addCover(slide, backgroundBytes, foregroundBytes) {
  slide.background.fill = '#ECEAE6';
  const box = { left: 0, top: 0, width: 1280, height: 720 };
  slide.images.add({ blob: backgroundBytes, contentType: 'image/png', alt: 'Original BMW 1 Series studio image from the FWD front page', fit: 'cover', position: box });
  type(slide, '1 SERIES', 458, 113, 760, 210, 160, '#C5BFB7', true);
  slide.images.add({ blob: foregroundBytes, contentType: 'image/png', alt: 'Original car silhouette, retaining reflections, in front of the series label', fit: 'cover', position: box });
  type(slide, 'FWD', 72, 78, 46, 28, 20, INK, true);
  type(slide, '//', 126, 75, 30, 28, 21, '#2D5FF4', true);
  type(slide, 'BMW VEHICLE REQUIREMENTS', 168, 82, 300, 18, 12, MUTED);
  type(slide, 'AI vehicle\nrequirements', 72, 151, 450, 112, 48, INK, true);
  type(slide, 'From customer evidence to PM decisions', 76, 286, 435, 34, 19, MUTED);
  slide.speakerNotes.text = 'Cover uses original 2560×1440 vehicle-viewer image frontend/public/images/bmw/exterior/31GE/04.webp. The 1 SERIES text is an editable background layer, occluded by the original car silhouette. Vehicle imagery is representative, without an equipment or BMW approval claim.';
}
