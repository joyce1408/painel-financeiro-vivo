# Emula a saída de js/pdftext.js (linhas agrupadas pela coordenada y) a partir do pdftotext -bbox, para testes em Node.
import subprocess,sys,json,re,html
def lines(path):
    x=subprocess.run(['pdftotext','-bbox',path,'-'],capture_output=True,text=True).stdout
    out=[]
    for page in x.split('<page ')[1:]:
        L={}
        for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>',page):
            x0,y0,x1,y1,w=float(m[1]),float(m[2]),float(m[3]),float(m[4]),html.unescape(m[5])
            y=round(y1/2)*2
            L.setdefault(y,[]).append((x0,x1,w))
        for y in sorted(L):
            ws=sorted(L[y]);s='';px=None
            for x0,x1,w in ws:
                if px is not None: s+= '   ' if x0-px>12 else ' '
                s+=w;px=x1
            out.append(s.strip())
        out.append('--- fim da página ---')
    return out
res={p:lines(p) for p in sys.argv[1:]}
json.dump(res,sys.stdout,ensure_ascii=False)
