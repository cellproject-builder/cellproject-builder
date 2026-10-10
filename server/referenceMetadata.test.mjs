import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImageMetadata, parseTargets, rankImageMetadata } from './referenceMetadata.mjs';
const htmlPage = html => ({ mime: 'text/html', finalUrl: 'https://example.com/openarm', bytes: Buffer.from(html) });
test('missing URLs, executable URLs, credentials and SVG never become invented image candidates', () => {
  const page = { mime: 'text/html', finalUrl: 'https://example.com/page', bytes: Buffer.from('<meta property="og:image"><img><img src=""><img src="javascript:alert(1)"><img src="https://user:pass@example.com/photo.png"><img src="/icon.svg"><img src="/real.png" alt="Real"><img src="/real.png">') };
  const result = extractImageMetadata(page);
  assert.equal(result.length, 1); assert.equal(result[0].remoteUrl, 'https://example.com/real.png');
  assert.equal(result[0].title, 'Real');
});

test('motor search keeps the pictured component and rejects logos and complete robots despite page subject', () => {
  const page = htmlPage(`<title>OpenArm stepper motors and mechanics</title>
    <meta name="description" content="Four stepper motors, transmissions and structure">
    <meta property="og:image" content="/whole-robot.jpg">
    <header><img src="/logo.png" alt="OpenArm"></header>
    <img src="/complete-robot.jpg" alt="Complete OpenArm robot">
    <figure><img src="/part-123.jpg"><figcaption>NEMA 17 stepper motor</figcaption></figure>
    <img src="/outro.jpg" alt="Motor de passo para bancada">`);
  const result = extractImageMetadata(page, {}, { targetTerms: ['stepper motor', 'motor de passo'], query: 'stepper motor' });
  assert.deepEqual(result.map(image => image.remoteUrl).sort(), ['https://example.com/outro.jpg', 'https://example.com/part-123.jpg']);
  assert.equal(result.find(image => image.remoteUrl.endsWith('/part-123.jpg')).title, 'NEMA 17 stepper motor');
});

test('generic extraction rejects obvious site chrome without inventing page subject as image description', () => {
  const result = extractImageMetadata(htmlPage(`<title>Stepper motors</title><meta name="description" content="Buy stepper motors">
    <img src="/company-logo.png"><nav><img src="/menu.jpg" alt="Motor de passo"></nav>
    <img src="/sale-banner.jpg" alt="Stepper motor sale"><img src="/photo.jpg">`));
  assert.deepEqual(result.map(image => image.remoteUrl), ['https://example.com/photo.jpg']);
  assert.equal(result[0].description, '');
  assert.notEqual(result[0].title, 'Stepper motors');
});

test('an explicitly requested logo remains a candidate and component terms match their plural aliases', () => {
  const logo = extractImageMetadata(htmlPage('<header><img src="/acme-logo.png" alt="Acme logo"></header>'), {}, { query: 'Acme logo', targetTerms: ['Acme logo'] });
  assert.equal(logo.length, 1);
  const motors = extractImageMetadata(htmlPage('<img src="/one.jpg" alt="Stepper motors"><img src="/two.jpg" alt="Motores de passo"><img src="/motorcycle.jpg" alt="Motorcycle">'), {}, { targetTerms: ['stepper motor', 'motor de passo'] });
  assert.deepEqual(motors.map(image => image.remoteUrl), ['https://example.com/one.jpg', 'https://example.com/two.jpg']);
});

test('component evidence can come from the filename or a nearby product name without borrowing the page heading', () => {
  const result = extractImageMetadata(htmlPage(`<h1>Entire robot</h1><img src="/stepper-motor-side.jpg">
    <article class="product-card"><h2>Motor de passo 42 mm</h2><img src="/123.jpg"></article>
    <img src="/unlabelled.jpg">`), {}, { targetTerms: ['stepper motor', 'motor de passo'] });
  assert.deepEqual(result.map(image => image.remoteUrl).sort(), ['https://example.com/123.jpg', 'https://example.com/stepper-motor-side.jpg']);
});

test('deduplication preserves stronger per-image evidence when OG and img use the same asset', () => {
  const result = extractImageMetadata(htmlPage('<title>Robot center</title><meta property="og:image" content="/photo.jpg"><img src="/photo.jpg#preview" alt="Stepper motor">'), {}, { targetTerms: ['stepper motor'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Stepper motor');
});

test('component searches exclude obvious video demonstrations and linked video thumbnails', () => {
  const page = htmlPage(`<meta property="og:image" content="/stepper-motor-demo.jpg">
    <img src="/stepper-motor-demo.jpg#video" alt="Video of a motor stepper driver board driving a stepper motor connected to a microcontroller.">
    <div class="video-thumbnail"><img src="/thumb.jpg" alt="Stepper motor"></div>
    <a href="https://www.youtube.com/watch?v=example"><img src="/youtube.jpg" alt="Stepper motor"></a>
    <img src="/product.jpg" alt="Stepper motor">`);
  const result = extractImageMetadata(page, {}, { query: 'stepper motor', targetTerms: ['stepper motor', 'motor de passo'] });
  assert.deepEqual(result.map(image => image.remoteUrl), ['https://example.com/product.jpg']);
});

test('explicit video requests keep relevant thumbnail references', () => {
  const page = htmlPage('<div class="video-thumbnail"><img src="/demo.jpg" alt="Video of a stepper motor"></div>');
  const result = extractImageMetadata(page, {}, { query: 'stepper motor video', targetTerms: ['stepper motor'] });
  assert.equal(result.length, 1);
});

test('direct component photos exclude unrequested controller accessories without motor-specific rules', () => {
  const page = htmlPage('<img src="/esp32-controller-expansion.jpg" alt="ESP32 controller expansion board"><img src="/actual.jpg" alt="ESP32 module">');
  const result = extractImageMetadata(page, {}, { query: 'ESP32', targetTerms: ['ESP32'] });
  assert.equal(result[0].title, 'ESP32 module');
  assert.equal(result.length, 1);
});

test('structured targets require the requested model in image evidence and normalize identifier separators', () => {
  const page = htmlPage(`<title>NEMA 23 stepper motor</title>
    <img src="/seventeen.jpg" alt="NEMA 17 stepper motor">
    <img src="/wrong-suffix.jpg" alt="NEMA 230 stepper motor">
    <img src="/letter-suffix.jpg" alt="NEMA 23A stepper motor">
    <img src="/first.jpg" alt="NEMA23 stepper motor">
    <img src="/second.jpg" alt="NEMA-23 stepper motor">
    <img src="/third.jpg" alt="NEMA 23 stepper motor">`);
  const result = extractImageMetadata(page, {}, { query: 'NEMA 23 stepper motor', targetTerms: ['stepper motor', 'NEMA 23'], targets: [{ aliases: ['stepper motor'], identifiers: ['NEMA23'] }] });
  assert.deepEqual(result.map(image => image.remoteUrl).sort(), ['https://example.com/first.jpg', 'https://example.com/second.jpg', 'https://example.com/third.jpg']);
});

test('different object groups combine as OR while each group requires all its own identifiers', () => {
  const page = htmlPage(`<img src="/servo.jpg" alt="SG90 servo">
    <img src="/module.jpg" alt="ESP32-S3 module">
    <img src="/compact.jpg" alt="ESP32S3 module">
    <img src="/other-servo.jpg" alt="SG92 servo">
    <img src="/other-module.jpg" alt="ESP32-S2 module">
    <img src="/missing-id.jpg" alt="NEMA23 stepper motor">
    <img src="/two-ids.jpg" alt="57BYG NEMA-23 stepper motor">`);
  const result = extractImageMetadata(page, {}, { targets: [{ aliases: ['servo'], identifiers: ['SG90'] }, { aliases: ['ESP32'], identifiers: ['ESP32-S3'] }, { aliases: ['stepper motor'], identifiers: ['NEMA 23', '57BYG'] }] });
  assert.deepEqual(result.map(image => image.remoteUrl).sort(), ['https://example.com/compact.jpg', 'https://example.com/module.jpg', 'https://example.com/servo.jpg', 'https://example.com/two-ids.jpg']);
});

test('secondary objects in a caption cannot qualify a whole assembly as a component photo', () => {
  const page = htmlPage(`<meta property="og:image" content="/stepper-motor-assembly.jpg">
    <article class="product-card"><h2>Stepper motors</h2><img src="/stepper-motor-assembly.jpg" alt="Complete robot arm with stepper motors"></article>
    <img src="/another-arm.jpg" alt="Robot arm using stepper motors">
    <img src="/photo.jpg" alt="Photo of a stepper motor">
    <img src="/angled.jpg" alt="Angled shot of a stepper motor with cables">`);
  const options = { query: 'stepper motor', targetTerms: ['stepper motor'] };
  assert.deepEqual(extractImageMetadata(page, {}, options).map(image => image.remoteUrl).sort(), ['https://example.com/angled.jpg', 'https://example.com/photo.jpg']);
  const assembly = extractImageMetadata(page, {}, { targets: [{ aliases: ['robot arm'], identifiers: [] }] });
  assert.deepEqual(assembly.map(image => image.remoteUrl).sort(), ['https://example.com/another-arm.jpg', 'https://example.com/stepper-motor-assembly.jpg']);
});

test('explicitly requested accessories retain their full ranking', () => {
  const page = htmlPage('<img src="/first.jpg" alt="ESP32 controller expansion board"><img src="/second.jpg" alt="ESP32 module">');
  const result = extractImageMetadata(page, {}, { query: 'ESP32 controller', targetTerms: ['ESP32'] });
  assert.equal(result[0].title, 'ESP32 controller expansion board');
});

test('compact alphanumeric aliases match separated model spelling', () => {
  const result = extractImageMetadata(htmlPage('<img src="/module.jpg" alt="ESP32-S3 module">'), {}, { targets: [{ aliases: ['ESP32S3'], identifiers: [] }] });
  assert.equal(result.length, 1);
});

test('a primary figure caption cannot be bypassed by a generic alt and matching filename', () => {
  const result = extractImageMetadata(htmlPage('<figure><img src="/stepper-motor.jpg" alt="Product image"><figcaption>Complete robot arm with stepper motors</figcaption></figure>'), {}, { targets: [{ aliases: ['stepper motor'], identifiers: [] }] });
  assert.deepEqual(result, []);
});

test('unrequested HAT, shields and breakout boards are excluded including OG duplicates', () => {
  const page = htmlPage(`<meta property="og:image" content="/stepper-motor-hat.jpg">
    <img src="/stepper-motor-hat.jpg#view" alt="Angled shot of Adafruit DC &amp; Stepper Motor HAT.">
    <img src="/shield.jpg" alt="Stepper motor shield">
    <img src="/breakout.jpg" alt="Stepper motor breakout board">
    <img src="/driver.jpg" alt="Stepper motor driver">
    <img src="/motor.jpg" alt="Stepper motor">`);
  const result = extractImageMetadata(page, {}, { query: 'stepper motor', targets: [{ aliases: ['stepper motor'], identifiers: [] }] });
  assert.deepEqual(result.map(image => image.remoteUrl), ['https://example.com/motor.jpg']);
});

test('explicit HAT, board and controladora requests keep controller references', () => {
  const page = htmlPage('<img src="/hat.jpg" alt="Adafruit Stepper Motor HAT"><img src="/controller.jpg" alt="Stepper motor controller breakout board">');
  for (const query of ['stepper motor HAT', 'stepper motor board', 'placa para motor de passo', 'controladora de motor de passo']) {
    const result = extractImageMetadata(page, {}, { query, targetTerms: ['stepper motor', 'motor de passo'] });
    assert.deepEqual(result.map(image => image.remoteUrl).sort(), ['https://example.com/controller.jpg', 'https://example.com/hat.jpg'], query);
  }
});

test('motors with reductions, encoders or secondary accessories remain and hat matches whole words only', () => {
  const page = htmlPage(`<img src="/gearbox.jpg" alt="Stepper motor with gearbox and encoder">
    <img src="/reduction.jpg" alt="Motor de passo com redução e encoder">
    <img src="/mount.jpg" alt="Stepper motor with mounting bracket">
    <img src="/what.jpg" alt="What a stepper motor looks like">`);
  const result = extractImageMetadata(page, {}, { query: 'stepper motor', targetTerms: ['stepper motor', 'motor de passo'] });
  assert.equal(result.length, 4);
});

const arduinoTargets = [{ aliases: ['Arduino Uno', 'Arduino Uno board'], identifiers: ['UNO'] }, { aliases: ['USB cable', 'cabo USB'], identifiers: [] }];

test('nominal aliases match product names independently of descriptive search queries, without mixing board and cable ownership', () => {
  const targets = [
    { query: 'Arduino Uno board', aliases: ['Arduino Uno'], identifiers: ['Arduino Uno'] },
    { query: 'USB data cable', aliases: ['USB cable', 'cabo USB'], identifiers: [] },
  ];
  const page = htmlPage(`<img src="/board.jpg" alt="Arduino UNO Rev3">
    <img src="/cable.jpg" alt="Arduino UNO Cable USB">
    <img src="/usb.jpg" alt="USB cable">`);
  const result = extractImageMetadata(page, {}, { query: 'Arduino Uno board USB data cable', targets });
  assert.equal(result.length, 3);
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/board.jpg')).matchedTargetIndexes, [0]);
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/cable.jpg')).matchedTargetIndexes, [1]);
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/usb.jpg')).matchedTargetIndexes, [1]);
});

test('data cable aliases tolerate omitted function metadata but not explicit charge-only or no-data contradictions', () => {
  const targets = [
    { query: 'Arduino Uno board', aliases: ['Arduino Uno', 'placa Arduino Uno'], identifiers: ['Arduino Uno'] },
    { query: 'USB data cable', aliases: ['cabo USB de dados', 'USB data cable'], identifiers: [] },
  ];
  const page = htmlPage(`<img src="/board.jpg" alt="Arduino UNO Rev3">
    <img src="/generic.jpg" alt="USB cable">
    <img src="/compatible.jpg" alt="Arduino UNO Cable USB">
    <img src="/data-and-charge.jpg" alt="USB charging and data cable">
    <img src="/charge-only.jpg" alt="USB cable for charging only">
    <img src="/power-only.jpg" alt="USB power-only cable">
    <img src="/somente.jpg" alt="Cabo USB somente carga">
    <img src="/no-data.jpg" alt="USB cable with no data transfer">
    <img src="/sem-dados.jpg" alt="Cabo USB sem dados">
    <img src="/not-only.jpg" alt="USB data cable, not charging only">`);
  const result = extractImageMetadata(page, {}, { query: 'Arduino Uno board USB data cable', targets });
  assert.deepEqual(new Set(result.map(image => image.remoteUrl.split('/').pop())), new Set(['board.jpg', 'generic.jpg', 'compatible.jpg', 'data-and-charge.jpg', 'not-only.jpg']));
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/board.jpg')).matchedTargetIndexes, [0]);
  for (const cable of result.filter(image => !image.remoteUrl.endsWith('/board.jpg'))) assert.deepEqual(cable.matchedTargetIndexes, [1]);
});

test('a functional per-target query rejects explicit contradictions even when its nominal aliases omit data', () => {
  const targets = [
    { query: 'Arduino Uno board', aliases: ['Arduino Uno'], identifiers: ['Arduino Uno'] },
    { query: 'USB data cable', aliases: ['USB cable'], identifiers: [] },
  ];
  const page = htmlPage('<img src="/board.jpg" alt="Arduino Uno"><img src="/cable.jpg" alt="USB cable"><img src="/charging.jpg" alt="USB charging only cable">');
  const result = extractImageMetadata(page, {}, { targets });
  assert.deepEqual(new Set(result.map(image => image.title)), new Set(['Arduino Uno', 'USB cable']));
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/board.jpg')).matchedTargetIndexes, [0]);
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/cable.jpg')).matchedTargetIndexes, [1]);
});

test('per-target query remains optional for legacy callers and bounded when supplied', () => {
  const target = { aliases: ['USB cable'], identifiers: [] };
  assert.deepEqual(parseTargets([target]), [target]);
  assert.deepEqual(parseTargets([{ ...target, query: ' USB data cable ' }]), [{ ...target, query: 'USB data cable' }]);
  for (const query of [null, 1, '', '  ', 'a'.repeat(501)]) assert.throws(() => parseTargets([{ ...target, query }]), /query/i);
});

test('optional data wording does not erase connector variants, exact models or unrelated qualifiers', () => {
  const page = htmlPage(`<img src="/generic.jpg" alt="USB cable">
    <img src="/type-a.jpg" alt="USB-A cable">
    <img src="/type-c.jpg" alt="USB-C cable">
    <img src="/named.jpg" alt="USB-C cable F2CU052">
    <img src="/other.jpg" alt="USB-C cable F2CU029">
    <img src="/short.jpg" alt="USB-C cable 1m">
    <img src="/long.jpg" alt="USB-C cable 2m">`);
  const exact = extractImageMetadata(page, {}, { targets: [{ aliases: ['USB-C data cable'], identifiers: ['F2CU052'] }] });
  assert.deepEqual(exact.map(image => image.remoteUrl), ['https://example.com/named.jpg']);
  const length = extractImageMetadata(page, {}, { targets: [{ aliases: ['USB-C data cable 2m'], identifiers: [] }] });
  assert.deepEqual(length.map(image => image.remoteUrl), ['https://example.com/long.jpg']);
  const connector = extractImageMetadata(page, {}, { targets: [{ aliases: ['USB-C data cable'], identifiers: [] }] });
  assert.equal(connector.some(image => /\/(generic|type-a)\.jpg$/.test(image.remoteUrl)), false);
});

test('an Arduino-compatible USB cable belongs only to the cable target, while a board with a cable remains a board', () => {
  const page = htmlPage(`<img src="/cable-a.jpg" alt="Arduino UNO Cable USB">
    <img src="/cable-b.jpg" alt="USB cable for Arduino Uno">
    <img src="/cable-c.jpg" alt="Cabo USB para Arduino Uno">
    <img src="/board.jpg" alt="Arduino Uno board with a USB cable">`);
  const result = extractImageMetadata(page, {}, { targets: arduinoTargets });
  assert.equal(result.length, 4);
  for (const cable of result.filter(image => image.remoteUrl.includes('/cable-'))) assert.deepEqual(cable.matchedTargetIndexes, [1]);
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/board.jpg')).matchedTargetIndexes, [0]);
  assert.deepEqual(extractImageMetadata(page, {}, { targets: [arduinoTargets[0]] }).map(image => image.title), ['Arduino Uno board with a USB cable']);
});

test('accessory intent is scoped to its own target rather than permitting accessories in every group', () => {
  const page = htmlPage(`<img src="/shield.jpg" alt="Arduino Uno shield">
    <img src="/board.jpg" alt="Arduino Uno">
    <img src="/servo.jpg" alt="SG90 servo with mounting bracket">`);
  const result = extractImageMetadata(page, {}, { query: 'Arduino Uno and Arduino Uno shield and servo', targets: [
    { aliases: ['Arduino Uno'], identifiers: [] }, { aliases: ['Arduino Uno shield'], identifiers: [] }, { aliases: ['servo'], identifiers: ['SG90'] },
  ] });
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/shield.jpg')).matchedTargetIndexes, [1]);
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/board.jpg')).matchedTargetIndexes, [0]);
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/servo.jpg')).matchedTargetIndexes, [2]);
});

test('a generic board alias does not make a separately requested shield count as the board', () => {
  const targets = [
    { aliases: ['Arduino Uno board', 'Arduino Uno'], identifiers: ['UNO'] },
    { aliases: ['Arduino Uno shield'], identifiers: ['UNO'] },
  ];
  const result = extractImageMetadata(htmlPage('<img src="/shield.jpg" alt="Arduino Uno shield"><img src="/board.jpg" alt="Arduino Uno board">'), {}, { query: 'Arduino Uno board and Arduino Uno shield', targets });
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/shield.jpg')).matchedTargetIndexes, [1]);
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/board.jpg')).matchedTargetIndexes, [0]);
});

test('a generic alt cannot let a cable filename count as a board, while a named board caption wins over its filename', () => {
  const page = htmlPage(`<img src="/arduino-uno-usb-cable.jpg" alt="Product image">
    <img src="/arduino-uno-board-and-cable.jpg" alt="Arduino Uno board with a USB cable">`);
  const result = extractImageMetadata(page, {}, { targets: arduinoTargets });
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/arduino-uno-usb-cable.jpg')).matchedTargetIndexes, [1]);
  assert.deepEqual(result.find(image => image.remoteUrl.endsWith('/arduino-uno-board-and-cable.jpg')).matchedTargetIndexes, [0]);
});

test('per-target balancing reserves room for a board despite twelve higher-scored cable photos', () => {
  const page = htmlPage(Array.from({ length: 16 }, (_, i) => `<figure><img src="/cable-${i}.jpg" alt="Arduino Uno Cable USB ${i}" title="USB cable"><figcaption>USB cable for Arduino Uno</figcaption></figure>`).join('') + '<img src="/board.jpg" alt="Arduino Uno">');
  const result = rankImageMetadata(extractImageMetadata(page, {}, { targets: arduinoTargets }), { targets: arduinoTargets });
  assert.equal(result.length, 12);
  assert.ok(result.some(image => image.remoteUrl.endsWith('/board.jpg')));
  assert.deepEqual(new Set(result.slice(0, 2).flatMap(image => image.matchedTargetIndexes)), new Set([0, 1]));
});

test('target coverage takes priority over source caps when many different components share one source', () => {
  const targets = Array.from({ length: 8 }, (_, i) => ({ aliases: [`component-${i}`], identifiers: [] }));
  const images = extractImageMetadata(htmlPage(targets.map((target, i) => `<img src="/component-${i}.jpg" alt="${target.aliases[0]}">`).join('')), {}, { targets });
  const extra = extractImageMetadata({ ...htmlPage('<img src="/extra.jpg" alt="component-0">'), finalUrl: 'https://other.example/catalog' }, {}, { targets });
  const result = rankImageMetadata([...images, ...extra], { targets });
  assert.deepEqual(new Set(result.flatMap(image => image.matchedTargetIndexes)), new Set([0, 1, 2, 3, 4, 5, 6, 7]));
});
