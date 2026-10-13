# SB선보 복지 가이드 AI 챗봇 v1.0

SB선보 복지 가이드북 PDF를 기반으로 Netlify에서 운영되는 사내 복지 챗봇입니다.

## 기본 기능

- 사용자 로그인: `admin / 1111`, `user1 / 1111`
- 관리자 권한: PDF 규정 업로드, 사용자 Excel 일괄 업로드, 질문 유형 분석, 미매칭 질문 분석
- 사용자 기능: 복지 질문, 답변 메모 저장, PC/모바일 TTS 듣기
- 지식 갱신: 개정 PDF 업로드 시 텍스트 추출 후 챗봇 지식 갱신
- 데이터 저장: Netlify Blobs 사이트 범위 저장소 사용
- NAVER WORKS 연동: Bot Callback URL 및 메시지 회신 API 엔드포인트 포함

## 배포 구조

```text
GitHub Private 저장소
  ├─ public/index.html        # 프론트엔드 시작 파일
  ├─ public/app.js            # 화면, TTS, PDF/Excel 업로드
  ├─ netlify/functions/api.mjs # 로그인, 챗봇, 관리자, NAVER WORKS API
  └─ netlify/functions/seed.mjs # 2026년 복지 가이드북 초기 지식

Netlify
  ├─ Static site hosting
  ├─ Functions
  └─ Blobs
```

## GitHub/Netlify 배포

1. GitHub에서 Private 저장소 생성
2. 본 폴더의 파일 전체를 저장소 루트에 업로드
3. Netlify > Add new project > Import from GitHub
4. Build command는 비워도 되며, Publish directory는 `public`입니다.
5. 배포 후 `https://사이트주소.netlify.app` 접속

## 관리자 초기 접속

```text
ID: admin
PW: 1111
```

운영 전 관리자 비밀번호를 반드시 변경하세요.

## 사용자 Excel 업로드 컬럼

권장 컬럼명:

```text
아이디, 이름, 비밀번호, 권한, 부서, 직위, 이메일, 네이버웍스ID
```

- 권한: `admin` 또는 `user`
- 비밀번호가 비어 있으면 `1111`로 생성됩니다.

## PDF 업로드 및 자동 갱신

관리자 > 규정 PDF 업로드에서 개정 PDF를 선택 후 `PDF 반영`을 누르면 챗봇 지식이 교체됩니다.

- 텍스트형 PDF: 기본 추출
- 이미지형 PDF: OCR 모드 선택 권장
- OCR은 PC 성능과 페이지 수에 따라 시간이 걸릴 수 있습니다.

## TTS 안내

브라우저 Web Speech API를 사용합니다. PC와 모바일에서 지원되지만, 모바일은 사용자의 버튼 클릭 이후 재생되는 정책이 일반적입니다. 답변 카드의 `🔊 듣기` 버튼으로 안정적으로 실행하세요.

## NAVER WORKS 연동

Netlify 배포 후 Callback URL:

```text
https://사이트주소.netlify.app/api/naverworks
```

Developer Console의 Bot Callback URL에 위 주소를 등록합니다. 상세 설정은 `docs/NAVER_WORKS_SETUP.md`를 참고하세요.

## 주의사항

- 복지제도 해석상 애매한 경우 최종 판단은 사내 담당부서 기준입니다.
- 운영 중 데이터는 GitHub가 아니라 Netlify Blobs에 저장됩니다.
- 새 Netlify 사이트를 만들면 기존 Blobs 데이터는 자동 이전되지 않습니다.
