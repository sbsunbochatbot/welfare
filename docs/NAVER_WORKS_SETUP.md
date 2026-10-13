# NAVER WORKS Bot 연동 안내

## 1. Bot 생성

NAVER WORKS Developer Console에서 Bot을 생성합니다.

- Callback URL: `https://사이트주소.netlify.app/api/naverworks`
- Callback: On
- 메시지 유형: Text 권장
- Bot Secret: Netlify 환경변수로 등록

## 2. Netlify 환경변수

Netlify > Project configuration > Environment variables에 아래 값을 등록합니다.

필수:

```text
NAVER_WORKS_BOT_ID=봇 ID
NAVER_WORKS_BOT_SECRET=봇 Secret
```

테스트용 Access Token 직접 등록 방식:

```text
NAVER_WORKS_ACCESS_TOKEN=발급받은 access token
```

서비스 계정 JWT 자동 발급 방식:

```text
NAVER_WORKS_CLIENT_ID=클라이언트 ID
NAVER_WORKS_CLIENT_SECRET=클라이언트 Secret
NAVER_WORKS_SERVICE_ACCOUNT=서비스 계정 이메일
NAVER_WORKS_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
NAVER_WORKS_SCOPE=bot
```

## 3. 동작 흐름

```text
NAVER WORKS 사용자가 Bot에게 질문
→ Netlify /api/naverworks Callback 수신
→ X-WORKS-Signature 서명 검증
→ 복지 챗봇 답변 생성
→ Bot API로 사용자 또는 메시지방에 답변 전송
```

## 4. 검증 포인트

- Bot Secret이 정확하지 않으면 401 오류가 발생합니다.
- Access Token 또는 서비스 계정 정보가 없으면 Callback은 수신되지만 NAVER WORKS로 회신하지 못합니다.
- Bot API scope에는 `bot` 또는 `bot.message` 범위가 필요합니다.
