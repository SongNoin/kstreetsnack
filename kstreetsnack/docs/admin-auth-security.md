# 운영툴 Google 로그인 보안 경계

운영툴은 화면에 Google 버튼만 보이는 것에 의존하지 않습니다. `20260822020000_enforce_google_admin_sessions.sql` migration을 적용하면 데이터베이스가 매 요청에서 아래 조건을 모두 확인합니다.

- JWT가 일반 사용자용 `authenticated` 토큰이다.
- JWT의 `session_id`가 현재 사용자에게 속한 실제 `auth.sessions` 행이다.
- JWT의 `amr`에 `oauth`가 있다.
- 서명된 `app_metadata.provider` 또는 `app_metadata.providers`에 Google이 있다.
- 같은 사용자에게 `auth.identities.provider = 'google'` 행이 있다.
- 그 뒤에야 `admin_users`의 활성 역할을 읽는다.

따라서 같은 UID의 활성 최고 관리자 행이 있더라도 비밀번호 로그인, 이메일 OTP 또는 매직 링크로 만든 세션은 메뉴 CRUD, 품절 변경, 복구, 저장본 생성, 배포 요청, 운영자 관리 RPC와 관련 RLS를 통과하지 못합니다. UI가 사용하는 RPC 이름은 바뀌지 않습니다.

## 토큰 새로고침 후에도 동작하는 이유

Supabase의 [JWT 필드 문서](https://supabase.com/docs/guides/auth/jwt-fields)는 `amr`에 `oauth`, `password`, `otp`, `token_refresh` 같은 인증 방법이 기록되고 사용자 세션 JWT에 `session_id`가 포함된다고 설명합니다.

Supabase Auth의 [토큰 생성 코드](https://github.com/supabase/auth/blob/master/internal/tokens/service.go)는 refresh 요청에서도 기존 세션을 불러와 `CalculateAALAndAMR` 결과를 새 JWT에 넣습니다. [세션 AMR 코드](https://github.com/supabase/auth/blob/master/internal/models/sessions.go)는 최초 로그인 방법을 세션의 AMR claim으로 저장하고, 새 access token을 만들 때 그 저장값을 다시 계산합니다. 따라서 Google로 시작한 세션은 refresh 뒤에도 `oauth` 근거를 유지합니다.

`app_metadata`만으로는 현재 로그인 방법을 증명할 수 없고, `oauth`만으로는 어느 OAuth provider인지 알 수 없습니다. 그래서 데이터베이스는 `session_id + oauth AMR + Google app_metadata + Google identity`를 함께 확인합니다. 다른 OAuth provider는 Supabase Dashboard에서 켜지 않고 Google만 활성화해 두는 것이 전제입니다.

## 적용과 확인

이 migration은 기존 스키마·운영자 관리·복구·배포 migration 다음에 적용합니다. 그 다음 service-role 전용 복구 기준점 bootstrap migration을 적용할 수 있으며, 이는 Google 브라우저 권한을 넓히지 않습니다. 원격 프로젝트에는 검토가 끝난 migration만 migration 기록을 통해 반영합니다.

```text
supabase/migrations/20260822020000_enforce_google_admin_sessions.sql
```

적용 전후 확인 사항:

- Supabase Authentication → Sign In / Providers에서 Google은 켜고 Email은 끕니다.
- 기존 이메일/OTP 세션을 종료하고 운영자들이 Google로 다시 로그인합니다.
- `npm run verify:supabase`가 Google 활성화, Email 비활성화, owner의 Google identity와 app metadata를 모두 확인합니다.
- 비밀번호·이메일 OTP로 발급했던 토큰은 `current_admin_role()`에서 `null`이 되고 모든 관리자 변경 요청이 거절되는지 확인합니다.
- Secret/service-role key는 초기 데이터와 서버 작업을 위한 신뢰 경계로 유지되며 브라우저에 넣지 않습니다.

로그인 직후 권한이 없다고 보이면 먼저 로그아웃한 뒤 Google로 다시 로그인합니다. 과거 JWT에 `session_id` 또는 `amr`가 없다면 보안을 위해 실패하도록 설계했습니다.
