import { expect, it, vi } from "vitest"
vi.mock("../components/edit/scripts/textStyle",()=>({getItemText:(item:any)=>item.lines?.flatMap((line:any)=>line.text.map((t:any)=>t.value)).join(" ")||""}))
vi.mock("../components/helpers/array",()=>({clone:(value:any)=>structuredClone(value)}))
import { parsePowerPointPackage } from "./powerpoint"
import { PowerPointPackage } from "../converters/powerpoint/PowerPointHelper"

function packageWith(graphic: string, chart?: string) {
    return new PowerPointPackage(parsePowerPointPackage({contentPaths:{},xml:{
        "ppt/presentation.xml":'<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="s1"/></p:sldIdLst><p:sldSz cx="18288000" cy="10287000"/></p:presentation>',
        "ppt/_rels/presentation.xml.rels":'<Relationships><Relationship Id="s1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
        "ppt/slides/slide1.xml":`<p:sld xmlns:p="p" xmlns:a="a" xmlns:c="c" xmlns:r="r"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="1" name="Graphic"/></p:nvGraphicFramePr><p:xfrm><a:off x="952500" y="1905000"/><a:ext cx="3810000" cy="1905000"/></p:xfrm><a:graphic><a:graphicData>${graphic}</a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
        ...(chart?{
            "ppt/slides/_rels/slide1.xml.rels":'<Relationships><Relationship Id="chart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
            "ppt/charts/chart1.xml":chart
        }:{})
    }}))
}
const cell=(text:string,attrs='')=>`<a:tc ${attrs}><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2000"/><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`
it("retains table text, unequal widths, merged cells, and graphic-frame placement",()=>{
    const pkg=packageWith(`<a:tbl><a:tblGrid><a:gridCol w="952500"/><a:gridCol w="2857500"/></a:tblGrid><a:tr h="952500">${cell('First')}${cell('Second')}</a:tr><a:tr h="952500">${cell('Merged','gridSpan="2"')}${cell('','hMerge="1"')}</a:tr></a:tbl>`)
    const slide=pkg.getSlides()[0]!
    expect(slide.items).toHaveLength(3)
    const first=slide.items.find(i=>i.lines?.some(l=>l.text.some(t=>t.value==='First')))!
    const second=slide.items.find(i=>i.lines?.some(l=>l.text.some(t=>t.value==='Second')))!
    const merged=slide.items.find(i=>i.lines?.some(l=>l.text.some(t=>t.value==='Merged')))!
    expect(first.style).toContain('left: 100px;');expect(first.style).toContain('top: 200px;');expect(first.style).toContain('width: 100px;')
    expect(second.style).toContain('left: 200px;');expect(second.style).toContain('width: 300px;')
    expect(merged.style).toContain('width: 400px;');expect(merged.style).toContain('top: 300px;')
})
it("retains chart categories and cached values as editable chart data",()=>{
    const pkg=packageWith('<c:chart r:id="chart1"/>','<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Alpha</c:v></c:pt><c:pt idx="1"><c:v>Beta</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>12</c:v></c:pt><c:pt idx="1"><c:v>34</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>')
    const item=pkg.getSlides()[0]!.items[0]
    expect(item.type).toBe('chart');expect(item.chart?.type).toBe('bar')
    expect(JSON.parse(item.chart!.data!).map((row:string[])=>row.slice(0,2))).toEqual([['Alpha','12'],['Beta','34']])
    expect(pkg.warnings).toHaveLength(1)
})
it("reports an unreadable graphic with a visible placeholder",()=>{
    const pkg=packageWith('<c:chart r:id="missing"/>')
    const item=pkg.getSlides()[0]!.items[0]
    expect(item.type).toBe('text');expect(item.lines?.[0].text[0].value).toBe('Unsupported PowerPoint graphic')
    expect(pkg.warnings).toHaveLength(1)
})
it("preserves literal markup and DrawingML line breaks in editable text",()=>{
    const text='<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>&lt;tag&gt; &amp; first</a:t></a:r><a:br/><a:r><a:t>second</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>'
    const pkg=packageWith(`<a:tbl><a:tblGrid><a:gridCol w="3810000"/></a:tblGrid><a:tr h="1905000">${text}</a:tr></a:tbl>`)
    const value=pkg.getSlides()[0]!.items.flatMap(item=>item.lines||[]).flatMap(line=>line.text.map(run=>run.value)).join('')
    expect(value).toBe('&lt;tag&gt; &amp; first<br>second')
})
it("honors saved text autofit font scale and percentage line-space reduction",()=>{
    const text='<a:tc><a:txBody><a:bodyPr><a:normAutofit fontScale="50000" lnSpcReduction="20000"/></a:bodyPr><a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="4000"/><a:t>Fits</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>'
    const pkg=packageWith(`<a:tbl><a:tblGrid><a:gridCol w="3810000"/></a:tblGrid><a:tr h="1905000">${text}</a:tr></a:tbl>`)
    const run=pkg.getSlides()[0]!.items.flatMap(item=>item.lines||[]).flatMap(line=>line.text).find(run=>run.value==='Fits')!
    expect(run.style).toContain('font-size: 26.67px;')
    expect(run.style).toContain('line-height: 0.96em;')
})
