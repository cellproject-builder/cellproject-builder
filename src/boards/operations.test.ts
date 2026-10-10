import { expect, it } from 'vitest';
import { createBoardDocument, type BoardItem } from './model';
import { boardClipboard, parseBoardClipboard, pasteBoardItems, removeBoardItems, drawingItem, boardDrawingIdsNearPath, selectBoardItemsInLasso } from './operations';

const card: BoardItem = {id:'one',kind:'card',text:'**Ideia**',color:'#94a3b8',fontSize:16,x:10,y:20,width:260,height:180};
it('copies an independent snapshot and remaps only internal connections', () => {
  const document = {...createBoardDocument(),items:[card,{...card,id:'two',x:300},{...card,id:'other'}],edges:[{id:'a',source:'one',target:'two'},{id:'b',source:'one',target:'other'}]};
  const text = boardClipboard(document,['one','two']);
  document.items[0].text = 'changed later';
  const snapshot = parseBoardClipboard(text)!;
  expect(snapshot.items[0]).toMatchObject({text:'**Ideia**'});
  const pasted = pasteBoardItems(createBoardDocument(),snapshot,{x:100,y:200});
  expect(pasted.items).toHaveLength(2);
  expect(pasted.items[0]).toMatchObject({x:100,y:200,text:'**Ideia**'});
  expect(pasted.items[0].id).not.toBe('one');
  expect(pasted.edges).toEqual([{id:expect.any(String),source:pasted.items[0].id,target:pasted.items[1].id}]);
});
it('removes incident connections without touching other objects', () => {
  const document = {...createBoardDocument(),items:[card,{...card,id:'two'}],edges:[{id:'e',source:'one',target:'two'}]};
  expect(removeBoardItems(document,['one'])).toMatchObject({items:[{id:'two'}],edges:[]});
});
it('rejects corrupted board clipboard content and ignores ordinary text', () => {
  expect(parseBoardClipboard('hello')).toBeNull();
  expect(() => parseBoardClipboard('dynamic-board:v1\n{"items":[{"kind":"image","src":"javascript:alert(1)"}],"edges":[]}')).toThrow();
});
it('creates a movable drawing from world coordinates with valid local bounds', () => {
  const item = drawingItem([{x:-40,y:100},{x:20,y:120},{x:10,y:105}],'#a78bfa',2);
  expect(item).toMatchObject({kind:'drawing',x:-44,y:96,width:68,height:28});
  expect(item.points).toEqual([{x:4,y:4},{x:64,y:24},{x:54,y:9}]);
});
it('preserves pressure and brush settings when localizing a drawing', () => {
  const item = drawingItem([{x:20,y:40,pressure:.2},{x:80,y:60,pressure:.8}], '#facc15', 16, {tool:'highlighter',opacity:.35});
  expect(item).toMatchObject({tool:'highlighter',opacity:.35,widthStroke:16});
  expect(item.points.map(point=>point.pressure)).toEqual([.2,.8]);
});
it('erases only crossed drawings in world coordinates, including a sparse pointer movement', () => {
  const first=drawingItem([{x:100,y:100},{x:200,y:100}],'#a78bfa',2);
  const other=drawingItem([{x:100,y:200},{x:200,y:200}],'#a78bfa',2);
  const document={...createBoardDocument(),items:[card,first,other]};
  expect(boardDrawingIdsNearPath(document,[{x:150,y:20},{x:150,y:180}],8)).toEqual([first.id]);
  expect(boardDrawingIdsNearPath(document,[{x:150,y:50}],8)).toEqual([]);
});
it('hits a tiny stroke even when a long eraser movement crosses between sample intervals', () => {
  const tiny=drawingItem([{x:1.001,y:1.001}],'#a78bfa',.25);
  const document={...createBoardDocument(),items:[tiny]};
  expect(boardDrawingIdsNearPath(document,[{x:-99999,y:1.001},{x:99999,y:1.001}],.001)).toEqual([tiny.id]);
  expect(boardDrawingIdsNearPath(document,[{x:1.001,y:1.4}],.001)).toEqual([]);
});
it('selects strokes crossing a lasso and objects inside it without selecting bounding-box gaps', () => {
  const crossing=drawingItem([{x:-20,y:50},{x:120,y:50}],'#a78bfa',2);
  const gap=drawingItem([{x:-20,y:-20},{x:-20,y:120},{x:120,y:120}],'#a78bfa',2);
  const inside={...card,id:'inside',x:20,y:20,width:20,height:20};
  const outside={...card,id:'outside',x:200,y:200};
  const document={...createBoardDocument(),items:[crossing,gap,inside,outside]};
  expect(selectBoardItemsInLasso(document,[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}])).toEqual([crossing.id,inside.id]);
  expect(selectBoardItemsInLasso(document,[{x:0,y:0},{x:2,y:2}])).toEqual([]);
});
