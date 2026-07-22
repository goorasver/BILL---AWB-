# 빌(AWB) 입력 자동화 — 웹앱

프론트(입력폼) + 서버리스 함수(Gemini 호출). **Gemini API 키는 코드에 넣지 않고 Vercel 환경변수에만 보관**한다.

## 구조
```
web/
├─ index.html        # 화면(프론트). PDF는 /api/extract 로 보냄, 엑셀은 브라우저에서 파싱
└─ api/
   └─ extract.js     # 서버리스 함수. 환경변수 GEMINI_API_KEY 로 Gemini 호출
```

## 배포 (GitHub → Vercel)

### 1) GitHub에 올리기
- github.com 에서 **New repository** 생성 (예: `bill-awb`, Private 권장)
- 이 `web` 폴더 내용을 그 저장소에 올림
  - **git 사용 시** (이 폴더에서):
    ```
    git add .
    git commit -m "init"
    git branch -M main
    git remote add origin https://github.com/<계정>/bill-awb.git
    git push -u origin main
    ```
  - **git 없이**: GitHub 저장소 페이지에서 파일 드래그로 업로드 (단, `api/extract.js`는 경로 유지)

### 2) Vercel에서 가져오기
- vercel.com → **Add New… → Project** → 방금 만든 GitHub 저장소 **Import**
- Framework Preset: **Other** (그대로 두면 됨)
- **Deploy** 클릭

### 3) 환경변수(키) 설정 — 가장 중요 🔑
- Vercel 프로젝트 → **Settings → Environment Variables**
  - `GEMINI_API_KEY` = (본인 Gemini 키)  ← 여기에만 넣는다. 코드/GitHub엔 절대 X
  - (선택) `GEMINI_MODEL` = `gemini-2.5-flash`
- 저장 후 **Deployments → 최신 배포 … → Redeploy** (환경변수 반영)

### 4) 사용
- 배포된 URL 접속 → PDF/엑셀 드롭 → 자동 추출 → 확인·수정 → 하우스 파일 추출

## 로컬 테스트 주의
- `index.html`을 그냥 더블클릭(file://)하면 **엑셀 파싱은 되지만 PDF(=서버 필요)는 작동 안 함**.
- PDF까지 로컬 확인하려면 Vercel CLI가 필요: `npm i -g vercel && vercel dev` (Node 설치 필요).
- 가장 간단한 건 그냥 **Vercel에 배포해서 URL로 테스트**.

## 보안
- 키는 **Vercel 환경변수(서버)** 에만. 브라우저·코드·GitHub 어디에도 넣지 않는다.
- 고객 원본 파일(samples)은 이 저장소에 올리지 않는다.
