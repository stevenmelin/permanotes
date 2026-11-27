import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { convertPage } from '../src/lib/onenote.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const XML = `<?xml version="1.0"?>
<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="{p1}" name="Session Notes" dateTime="2024-01-02T03:04:05.000Z" lastModifiedTime="2024-02-03T04:05:06.000Z" pageLevel="2">
  <one:TagDef index="0" type="0" symbol="3" fontColor="automatic" highlightColor="none" name="To Do" />
  <one:TagDef index="1" type="1" symbol="13" fontColor="automatic" highlightColor="none" name="Important" />
  <one:QuickStyleDef index="0" name="PageTitle" fontName="Calibri Light" fontSize="20.0" />
  <one:QuickStyleDef index="1" name="p" fontName="Calibri" fontSize="11.0" />
  <one:QuickStyleDef index="2" name="h2" fontName="Calibri" fontSize="14.0" />
  <one:Title><one:OE quickStyleIndex="0"><one:T><![CDATA[Session Notes]]></one:T></one:OE></one:Title>
  <one:Outline>
    <one:OEChildren>
      <one:OE quickStyleIndex="2"><one:T><![CDATA[Mix notes]]></one:T></one:OE>
      <one:OE quickStyleIndex="1"><one:T><![CDATA[Plain <span style='font-weight:bold'>bold</span> and <a href="https://example.com">link</a> &amp; more]]></one:T>
        <one:OEChildren><one:OE><one:T><![CDATA[indented child]]></one:T></one:OE></one:OEChildren>
      </one:OE>
      <one:OE><one:Tag index="0" completed="true" /><one:T><![CDATA[Bounce stems]]></one:T></one:OE>
      <one:OE><one:Tag index="0" completed="false" /><one:T><![CDATA[Send to client]]></one:T></one:OE>
      <one:OE><one:List><one:Bullet bullet="2" fontSize="11.0" /></one:List><one:T><![CDATA[bullet one]]></one:T></one:OE>
      <one:OE><one:List><one:Number numberSequence="0" numberFormat="##." text="1." /></one:List><one:T><![CDATA[step one]]></one:T></one:OE>
      <one:OE><one:Tag index="1" completed="false" /><one:T><![CDATA[Deadline Friday]]></one:T></one:OE>
      <one:OE><one:Table bordersVisible="true"><one:Columns><one:Column index="0" width="72"/><one:Column index="1" width="72"/></one:Columns>
        <one:Row><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[Cue]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[Length]]></one:T></one:OE></one:OEChildren></one:Cell></one:Row>
        <one:Row><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[1m1]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren /></one:Cell></one:Row>
      </one:Table></one:OE>
      <one:OE><one:Image format="png"><one:Size width="10" height="10"/><one:Data>${PNG}</one:Data></one:Image></one:OE>
      <one:OE><one:InsertedFile pathCache="C:\\x\\cache.bin" pathSource="C:\\Music\\mix v2.wav" preferredName="mix v2.wav" exportedFile="files/001-0001 - mix v2.wav" /></one:OE>
      <one:OE><one:InsertedFile pathCache="" preferredName="lost.pdf" /></one:OE>
      <one:OE><one:Image format="emf"><one:Data>${PNG}</one:Data></one:Image></one:OE>
    </one:OEChildren>
  </one:Outline>
  <one:InkDrawing />
</one:Page>`;

let n = 0;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const mime = (f: string) => (f.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream');

test('converts a OneNote page', () => {
  const out = convertPage(XML, new DOMParser() as never, ids, mime);
  assert.equal(out.title, 'Session Notes');
  assert.equal(out.created, '2024-01-02T03:04:05.000Z');
  assert.equal(out.modified, '2024-02-03T04:05:06.000Z');
  assert.equal(out.level, 2);
  const h = out.html;
  assert.match(h, /<h2>Mix notes<\/h2>/);
  assert.match(h, /<p>Plain <strong>bold<\/strong> and <a href="https:\/\/example.com">link<\/a> &amp; more<\/p>/);
  assert.match(h, /<ul data-bullet="none"><li><p>indented child<\/p><\/li><\/ul>/);
  assert.match(h, /<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Bounce stems<\/p><\/li><li data-type="taskItem" data-checked="false"><p>Send to client<\/p><\/li><\/ul>/);
  assert.match(h, /<ul><li><p>bullet one<\/p><\/li><\/ul><ol><li><p>step one<\/p><\/li><\/ol>/);
  assert.match(h, /<p>\[Important\] Deadline Friday<\/p>/);
  assert.match(h, /<table><tbody><tr><td><p>Cue<\/p><\/td><td><p>Length<\/p><\/td><\/tr><tr><td><p>1m1<\/p><\/td><td><p><\/p><\/td><\/tr><\/tbody><\/table>/);
  assert.match(h, /<img src="pn-att:[0-9a-f-]{36}" alt="">/);
  assert.match(h, /<div data-pn-att="[0-9a-f-]{36}" data-name="mix v2.wav" data-mime="audio\/wav"><\/div>/);
  assert.match(h, /\[Missing attachment: lost.pdf\]/);
  assert.match(h, /Handwriting or drawing/);
  const imgs = out.attachments.filter((a) => a.kind === 'image');
  const files = out.attachments.filter((a) => a.kind === 'file');
  assert.equal(imgs.length, 2);
  assert.equal(files.length, 1);
  assert.equal(files[0].kind === 'file' && files[0].path, 'files/001-0001 - mix v2.wav');
  assert.ok(out.warnings.some((w) => /EMF/.test(w)));
  assert.ok(out.warnings.some((w) => /lost.pdf/.test(w)));
});

test('rejects non-OneNote XML loudly', () => {
  assert.throws(() => convertPage('<foo/>', new DOMParser() as never, ids, mime), /Expected a OneNote <Page>/);
});

const STYLED = `<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" name="Styled">
  <one:QuickStyleDef index="1" name="p" fontColor="automatic" highlightColor="automatic" font="Calibri" fontSize="11.0" spaceBefore="0.0" spaceAfter="0.0" />
  <one:Outline><one:OEChildren>
    <one:OE quickStyleIndex="1"><one:List><one:Number numberSequence="0" numberFormat="##." font="Calibri" bold="true" text="1." /></one:List><one:T><![CDATA[<span style='font-weight:bold'>Project</span>]]></one:T>
      <one:OEChildren>
        <one:OE><one:List><one:Number numberSequence="4" numberFormat="##." font="Calibri" text="a." /></one:List><one:T style="font-family:inherit;font-size:11.0pt"><![CDATA[<span style='background:yellow;mso-highlight:yellow'>Sol Battle</span>]]></one:T>
          <one:OEChildren><one:OE><one:List><one:Number numberSequence="2" numberFormat="##." font="Calibri" text="i." /></one:List><one:T><![CDATA[Flute]]></one:T></one:OE></one:OEChildren>
        </one:OE>
        <one:OE style="font-family:inherit;font-size:11.0pt;&#xA;color:#FA0000"><one:List><one:Number numberSequence="4" numberFormat="##." font="Calibri" text="b." /></one:List><one:T><![CDATA[Forge tracks]]></one:T></one:OE>
        <one:OE><one:List><one:Bullet bullet="3" fontSize="11.0" /></one:List><one:T><![CDATA[circle item]]></one:T></one:OE>
        <one:OE><one:List><one:Bullet bullet="25" fontSize="11.0" /></one:List><one:T><![CDATA[dash item]]></one:T>
          <one:OEChildren><one:OE><one:List><one:Bullet bullet="13" fontSize="11.0" /></one:List><one:T><![CDATA[square item]]></one:T></one:OE></one:OEChildren>
        </one:OE>
      </one:OEChildren>
    </one:OE>
    <one:OE style="font-family:Calibri;font-size:11.0pt;color:black"><one:List><one:Number numberSequence="0" numberFormat="##." font="Calibri" text="2." /></one:List><one:T><![CDATA[Black is default]]></one:T></one:OE>
    <one:OE style="font-family:Aptos;font-size:20.0pt;color:#747474"><one:T><![CDATA[Big grey]]></one:T></one:OE>
    <one:OE><one:T><![CDATA[]]></one:T></one:OE>
  </one:OEChildren></one:Outline>
</one:Page>`;

test('keeps OneNote colors, highlights, fonts and list styles', () => {
  const h = convertPage(STYLED, new DOMParser() as never, ids, mime).html;
  assert.match(h, /<ol><li><p><strong>Project<\/strong><\/p><ol type="a">/);
  assert.match(h, /<mark data-color="yellow">Sol Battle<\/mark>/);
  assert.match(h, /<ol type="i"><li><p>Flute/);
  assert.match(h, /<span style="color: #FA0000">Forge tracks<\/span>/);
  assert.match(h, /<ul data-bullet="circle"><li><p>circle item/);
  assert.match(h, /<ul data-bullet="dash"><li><p>dash item<\/p><ul data-bullet="square">/);
  assert.match(h, /<\/ul><\/li><li><p>Black is default<\/p><\/li><\/ol>/, 'black text stays default; item 2 continues the same list');
  assert.match(h, /<span style="color: #747474; font-family: Aptos; font-size: 20pt">Big grey<\/span>/);
  assert.match(h, /<p><\/p>$/, 'blank lines are kept');
});

test('emoji-only fonts from OneNote are not carried over', () => {
  const xml = `<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" name="E"><one:Outline><one:OEChildren>
    <one:OE><one:T><![CDATA[Game <span style='font-family:"Apple Color Emoji"'>🎮</span> night <span style='font-family:"Segoe UI Emoji";color:#FA0000'>🍿</span>]]></one:T></one:OE>
  </one:OEChildren></one:Outline></one:Page>`;
  const h = convertPage(xml, new DOMParser() as never, ids, mime).html;
  assert.ok(!/Emoji/.test(h), h);
  assert.match(h, /<span style="color: #FA0000">🍿<\/span>/, 'other formatting on the emoji is kept');
});
