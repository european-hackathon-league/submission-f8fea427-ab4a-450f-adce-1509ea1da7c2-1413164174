"""Refresh official, native-resolution BMW exterior assets. No credentials are saved.

From the repository root: python3 frontend/scripts/sync-bmw-exteriors.py
BMW's public configurator settings supply its image-service configuration.
"""
import concurrent.futures
import datetime
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'public/images/bmw'
MODELS = {
    'F70': [('116', '31GE'), ('120', '81GE'), ('123 xDrive', '61GE'), ('M135 xDrive', '21GE'), ('118d', '11GF'), ('120d', '21GF')],
    'G60': [('520i', '11FJ'), ('520d', '11FL'), ('520d xDrive', '21FL'), ('540d xDrive', '31FL'), ('530e', '71FJ'), ('530e xDrive', '81FJ'), ('550e xDrive', '11FK'), ('i5 eDrive40', '61HG'), ('i5 xDrive40', '31HG'), ('i5 M60 xDrive', '41HG')],
    'G70': [('740 xDrive', '61HZ'), ('740d xDrive', '21HZ'), ('750e xDrive', '71HZ'), ('M760e xDrive', '81HZ'), ('i7 50xDrive', '61HY'), ('i7 60xDrive', '71HY'), ('i7 M70 xDrive', '81HY')],
}


def fetch(url, headers=None):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=45) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def main():
    previous = json.loads((ROOT / 'exterior-sources.json').read_text()) if (ROOT / 'exterior-sources.json').exists() else {'models': {}}
    old_urls = {ROOT / 'exterior' / model['code'] / f'{index:02}.webp': url
                for model in previous['models'].values() for index, url in enumerate(model['frames'])}
    page = 'https://configure.bmw.de/de_DE/configure/G60/11FJ'
    html = fetch(page).decode()
    settings_file = re.search(r'/de_DE/settings\.[\w]+\.json', html).group()
    backend = json.loads(fetch('https://configure.bmw.de' + settings_file))['APP']['backend']
    settings = backend['settingsCosy']
    today = datetime.date.today().isoformat()
    tree_settings = backend['settingsVehicleTree']
    tree_url = f"{tree_settings['baseUrl']}/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/de/effect-dates/{today}/order-dates/{today}?gfs-policy=none&cluster=default&future-models=true&closest-fallback=true"
    tree = json.loads(fetch(tree_url, tree_settings['headers']))
    # Use the published snapshot, not the host date or a future production date.
    # COSY can return URLs for those dates that fail for individual camera angles.
    effect_date = tree['closestEffectDate']
    manifest = {'retrieved': datetime.date.today().isoformat(), 'source': page, 'models': {}}
    jobs = []
    for family, models in MODELS.items():
        for trim, code in models:
            model_range = tree[{'F70': '1', 'G60': '5', 'G70': '7'}[family]]['modelRanges'][family]
            combinations = [(line, combination) for line, data in model_range['lines'].items()
                            for combination in data['includedTransmissionVariants']
                            if combination['configuration']['modelCode'] == code and combination['constructible']]
            line, combination = min(combinations, key=lambda pair: len(pair[1]['configuration']['elements']))
            options = sorted(combination['configuration']['elements'])
            query = urllib.parse.urlencode({'effectdate': effect_date.replace('-', ''),
                                           'options': ','.join(options), 'background': 'sand', 'hub': settings['hub'], 'imagetype': 'webp'})
            url = f"{settings['baseUrl']}/image-urls/dynamic-images/mandators/connext-bmw/collections/walkaround-360/brands/bmwCar/models/{code}?{query}"
            images = json.loads(fetch(url, settings['headers']))['walkaround-360']['desktop_xl']
            angles = sorted(images['images'], key=lambda image: image['angle'])
            assert len(angles) == 36 and [image['angle'] for image in angles] == list(range(0, 360, 10))
            folder = ROOT / 'exterior' / code
            folder.mkdir(parents=True, exist_ok=True)
            for index, image in enumerate(angles):
                jobs.append((folder / f'{index:02}.webp', image['viewImage']))
            manifest['models'][family + '-' + trim.replace(' ', '-')] = {
                'code': code, 'sourcePage': f'https://configure.bmw.de/de_DE/configure/{family}/{code}',
                'width': images['metaData']['width'], 'height': images['metaData']['height'],
                'line': line, 'options': options, 'effectDate': effect_date,
                'frames': [image['viewImage'] for image in angles],
            }
            print(f'{family} {trim}: {images["metaData"]["width"]}px, 36 angles', flush=True)
    # G68 is the original China configuration; retain its native source and angle offset.
    original = json.loads((ROOT / 'rotation-sources.json').read_text())
    china = next(item for item in original['families'] if item['id'] == 'G68')
    folder = ROOT / 'exterior/g68'
    folder.mkdir(parents=True, exist_ok=True)
    for index, image in enumerate(china['sourceAngles']):
        jobs.append((folder / f'{index:02}.webp', image['url']))
    manifest['models']['G68-5-Series-Long-Wheelbase'] = {
        'code': 'g68', 'sourcePage': china['sourcePage'], 'width': 1200, 'height': 500,
        'frames': [image['url'] for image in china['sourceAngles']],
    }

    def save(job):
        path, url = job
        if not path.exists() or old_urls.get(path) != url:
            try:
                path.write_bytes(fetch(url))
            except Exception as error:
                raise RuntimeError(f'Could not fetch {path.relative_to(ROOT)}: {type(error).__name__}') from None

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(save, jobs))
    (ROOT / 'exterior-sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Complete: {len(jobs)} native frames.', flush=True)


if __name__ == '__main__':
    main()
