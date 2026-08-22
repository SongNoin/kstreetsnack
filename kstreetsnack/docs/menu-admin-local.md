# 운영툴 개발 환경 확인과 Supabase 연결

이 문서는 비개발자가 운영 대시보드와 메뉴·운영자 관리 화면을 로컬에서 확인하고, 인터넷에 있는 **개발용 Supabase 프로젝트**에 안전하게 연결하는 순서입니다.

> 이 작업은 실제 사이트를 배포하지 않으며 도메인도 바꾸지 않습니다. `확인용으로 저장`도 사이트 공개가 아니라 현재 메뉴 상태를 따로 보관하는 기능입니다.

## 5분 안에 보는 전체 순서

1. Supabase 없이 로컬 화면을 먼저 확인합니다.
2. 별도의 개발용 Supabase 프로젝트를 만듭니다.
3. SQL migration을 실행하고 Google OAuth를 연결합니다.
4. Google로 처음 로그인해 Auth UID를 확인합니다.
5. UID를 owner로 지정한 뒤 `dry-run → seed → verify:supabase` 순서로 실행합니다.
6. 메뉴 수정부터 미리보기까지 한 번 확인한 뒤 Secret key를 제거합니다.

명령어는 모두 이 파일이 있는 앱 폴더 `kstreetsnack/`에서 실행합니다.

## 1. Supabase 없이 로컬 화면 확인

처음 한 번만 패키지를 설치하고 검사를 실행합니다.

```bash
npm ci
npm run test:menu-admin
npm run seed:supabase -- --dry-run
npm run dev
```

`dry-run`의 핵심 숫자는 다음과 같아야 합니다.

```text
sections: 2
categories: 13
menuItems: 80
referencedImages: 13
```

Node 경고가 함께 보여도 마지막 숫자가 맞고 명령이 성공으로 끝나면 괜찮습니다.

브라우저에서 `http://127.0.0.1:3000/admin/` 대시보드를 연 뒤 `메뉴 관리`로 이동합니다. Supabase 설정이 없으면 이 브라우저에만 변경 내용이 저장됩니다.

- [ ] 메뉴 80개와 카테고리 13개가 보인다.
- [ ] 사진이 보인다.
- [ ] 메뉴와 카테고리를 추가·수정·보관·복원할 수 있다.
- [ ] 품절 변경과 순서 변경이 동작한다.
- [ ] `사이트 화면 미리보기`가 열린다.
- [ ] 새로고침 후에도 이 브라우저의 변경 내용이 남는다.

## 2. 인터넷에 있는 개발용 Supabase 프로젝트 만들기

- 실제 운영용과 섞이지 않도록 프로젝트 이름에 `dev`를 붙입니다. 예: `kstreetsnack-dev`
- 손님이 주로 접속하는 유럽과 가까운 지역을 선택합니다.
- 처음에는 Free 플랜으로 시작하고, 유료 플랜이나 추가 유료 기능은 승인 없이 켜지 않습니다.
- 데이터베이스 비밀번호는 비밀번호 관리 앱에 보관합니다. 소스 코드나 채팅에 보내지 않습니다.

무료 플랜의 한도와 장기 미사용 정책은 바뀔 수 있으므로 Supabase의 Usage 화면을 가끔 확인합니다.

## 3. SQL migration 실행

Supabase의 SQL Editor에서 새 쿼리를 열고 아래 파일의 **전체 내용**을 위에서부터 순서대로 한 번씩 실행합니다. 이 방법은 별도로 만든 개발용 프로젝트의 최초 확인에만 사용합니다. 실제 운영 프로젝트 반영은 나중에 Supabase CLI의 migration 기록을 통해 진행합니다.

```text
../supabase/migrations/20260819000000_create_menu_admin_schema.sql
../supabase/migrations/20260820000000_add_menu_admin_access_management.sql
../supabase/migrations/20260821000000_add_menu_admin_access_deletion.sql
../supabase/migrations/20260821010000_add_pretest_menu_restore.sql
../supabase/migrations/20260822000000_add_menu_deployment_pipeline.sql
../supabase/migrations/20260822010000_add_live_menu_release.sql
../supabase/migrations/20260822020000_enforce_google_admin_sessions.sql
../supabase/migrations/20260822030000_add_menu_restore_baseline_bootstrap.sql
../supabase/migrations/20260822040000_add_queued_deployment_failure_cas.sql
../supabase/migrations/20260822050000_add_idempotent_menu_create.sql
../supabase/migrations/20260822060000_allow_auth_actor_fk_cleanup.sql
../supabase/migrations/20260822070000_reapply_security_function_hardening.sql
```

기본 메뉴 migration을 이미 실행한 개발 프로젝트라면 아직 적용하지 않은 파일만 날짜 순서대로 새 쿼리에서 실행합니다. migration 파일 하나를 건너뛰거나 순서를 바꾸지 않습니다. 운영자 권한 삭제 기능은 Google 계정 자체를 삭제하지 않으며, 마지막 Google 세션 보안 migration은 기존 운영툴 RPC 이름을 그대로 유지합니다.

빈 프로젝트에서는 이 migration들을 **모두 먼저** 적용해도 됩니다. 복구 기준점 migration은 아직 공개 저장본이 없으면 테이블과 함수만 만들고 정상 종료합니다. 아래 seed가 정확한 초기 메뉴를 공개한 뒤 service-role 전용 함수가 2개 메뉴 그룹, 13개 카테고리, 80개 메뉴와 사진 준비 상태를 확인하고 복구 기준점을 한 번만 저장합니다. 이미 저장된 기준점은 다시 캡처하거나 덮어쓰지 않습니다.

실행 후 다음을 확인합니다.

- [ ] Table Editor에 `sections`, `categories`, `menu_items`, `menu_availability`, `admin_users`, `menu_admin_access_requests`, `menu_admin_access_audit`, `menu_releases`가 보인다.
- [ ] Storage에 `menu-images` 버킷이 보인다.
- [ ] SQL Editor에 빨간 오류가 없다.

오류가 하나라도 나오면 seed를 실행하지 말고 오류 화면을 개발자에게 전달합니다. 이 migration은 하나의 transaction으로 묶여 있어 오류가 나면 전체 변경이 되돌아가도록 구성했습니다.

## 4. Google 로그인 연결

### Google Cloud에서 Web OAuth Client 만들기

1. Google Cloud Console에서 프로젝트를 만들거나 선택합니다.
2. OAuth 동의 화면을 설정합니다. 테스트 상태라면 처음 로그인할 Google 계정을 Test user에 추가합니다.
3. OAuth Client ID를 만들 때 Application type은 **Web application**을 선택합니다.
4. Authorized JavaScript origins에 개발 주소 `http://127.0.0.1:3000`을 추가합니다.
5. Authorized redirect URI에 아래 주소를 정확히 추가합니다. `<project-ref>`는 Supabase Project URL의 프로젝트 식별자로 바꿉니다.

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Google에서 만든 Client ID와 Client Secret은 다음 Supabase 설정에만 사용합니다. **Google Client Secret을 `.env.local`, 소스 파일, 문서, 이메일, 메신저 또는 AI 채팅에 넣지 마세요.**

### Supabase에서 Google provider 켜기

1. Supabase의 Authentication → Providers에서 Google을 켭니다.
2. Google Cloud에서 만든 Client ID와 Client Secret을 입력하고 저장합니다.
3. Authentication → URL Configuration의 Redirect URLs에 아래 개발 주소를 정확히 추가합니다.

```text
http://127.0.0.1:3000/admin/auth/callback/
```

메뉴 관리 화면은 PKCE 일회용 코드를 이 전용 callback에서 안전하게 교환합니다. Redirect URL의 `/admin/auth/callback/`까지 빠짐없이 입력해야 합니다. OAuth 확인 중에는 `localhost` 대신 문서와 같은 `127.0.0.1` 주소로 접속합니다.

## 5. 공개 키로 첫 Google 로그인하고 Auth UID 확인

예시 파일을 복사합니다.

```bash
cp .env.example .env.local
```

먼저 Supabase 프로젝트 설정에서 아래 두 공개 값만 찾아 `.env.local`에 직접 붙여 넣습니다.

| `.env.local` 항목 | Supabase에서 찾을 값 | 용도 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | 프로젝트 주소 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_...`) | 브라우저 연결 |

개발 서버를 시작하고 Google로 한 번 로그인합니다.

```bash
npm run dev
```

브라우저에서 `http://127.0.0.1:3000/admin/`을 열어 `Google로 로그인`을 선택합니다. 첫 로그인 직후에는 아직 owner 권한이 없으므로 `사용 가능한 운영자 목록에 없습니다`라는 안내가 나오는 것이 정상입니다. 이 과정으로 Supabase Auth 사용자가 먼저 만들어집니다.

로그인 뒤 Supabase Authentication → Users에서 방금 생성된 Google 사용자를 열고, 이메일이 아닌 **User UID(UUID)** 를 복사합니다. 이제 `.env.local`에 아래 두 초기 설정 값을 직접 입력합니다.

| `.env.local` 항목 | Supabase에서 찾을 값 | 용도 |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_...`) | 최초 seed와 검사에만 사용 |
| `SUPABASE_OWNER_USER_ID` | 첫 Google 사용자의 User UID | 첫 owner 권한 부여 |

현재 공식 키인 **Publishable key + Secret key** 조합을 우선 사용합니다. 예전 `anon` JWT와 `service_role` JWT는 기존 프로젝트 호환용일 때만 사용합니다.

Google Client ID와 Google Client Secret은 `.env.local`에 넣지 않습니다. 앱은 Supabase에 설정한 Google provider를 통해 로그인합니다.

첫 설정에서 `SUPABASE_OWNER_USER_ID`는 **필수**입니다. 비워 두면 Google 로그인은 되어도 메뉴를 관리할 권한이 생기지 않습니다.

> `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`는 데이터 제한을 우회할 수 있는 매우 강한 키입니다. 절대 `NEXT_PUBLIC_`을 붙이지 말고, 브라우저·Git·화면 캡처·이메일·메신저·AI 채팅에 보내지 마세요. 반드시 본인이 `.env.local`에 직접 넣으세요.

`.env.local`은 Git에서 제외되어야 합니다. 다음 명령이 `.gitignore` 규칙을 보여주면 정상입니다.

```bash
git check-ignore -v .env.local
```

## 6. 초기 메뉴 넣기와 자동 확인

반드시 아래 순서대로 실행합니다.

```bash
npm run seed:supabase -- --dry-run
npm run seed:supabase
npm run verify:supabase
```

seed 결과에서 다음을 확인합니다.

- [ ] `sections: 2`
- [ ] `categories: 13`
- [ ] `menuItems: 80`
- [ ] `ownerCreated: true`
- [ ] `releaseId`가 비어 있지 않다.
- [ ] `restoreBaseline.itemCount: 80`
- [ ] `restoreBaseline.sourceReleaseId`가 `releaseId`와 같다.
- [ ] `deploymentTriggered: false`

`verify:supabase`가 오류 없이 끝나야 다음 단계로 갑니다. 이 검사는 테이블, 메뉴 수, 사진 저장소, 첫 owner 권한과 확인용 저장 상태가 올바른지 확인합니다.

seed는 최초 설정 명령입니다. 정상 완료 후 다시 실행하지 않습니다.

### seed가 중간에 실패한 경우에만

오류 원인을 먼저 고친 뒤, **같은 개발용 프로젝트와 같은 `.env.local`** 에서 다음 명령으로 남은 초기화만 이어서 실행합니다.

```bash
npm run seed:supabase -- --resume
npm run verify:supabase
```

`--resume`은 최초 seed가 중간에 실패했을 때만 사용합니다. 공개 저장본 생성은 성공했지만 응답 또는 복구 기준점 저장 응답만 유실된 경우에도, 정확한 초기 데이터와 단 하나의 초기 저장본인지 다시 확인한 뒤 기준점 저장만 안전하게 재시도합니다. 이미 같은 기준점이 만들어졌다면 기존 행을 확인하고 성공으로 끝내며 다시 캡처하지 않습니다. 운영자가 이미 수정한 프로젝트나 다른 프로젝트에는 사용하지 않습니다.

> **절대 실행 금지:** 연결된 Supabase 프로젝트에서 `supabase db reset --linked` 또는 그와 같은 원격 DB 초기화 명령을 실행하지 마세요. 메뉴, 계정 권한, 품절 상태와 저장 기록이 삭제될 수 있습니다.

## 7. 연결된 화면 처음부터 끝까지 확인(E2E)

환경 변수를 바꾼 뒤 개발 서버를 다시 시작합니다.

```bash
npm run dev
```

`http://127.0.0.1:3000/admin/` 대시보드와 `http://127.0.0.1:3000/admin/menu/` 메뉴 관리에서 다음을 확인합니다.

- [ ] 화면 상단에 온라인 연결 상태가 보인다.
- [ ] owner로 등록한 Google 계정으로 로그인할 수 있다.
- [ ] 메뉴 80개, 카테고리 13개와 사진이 보인다.
- [ ] 메뉴 하나를 품절로 바꾼 뒤 새로고침해도 유지된다.
- [ ] 그 메뉴를 다시 판매 중으로 되돌린다.
- [ ] 메뉴 또는 카테고리 순서를 바꾼 뒤 새로고침해도 유지된다.
- [ ] 테스트한 순서를 원래대로 되돌린다.
- [ ] `확인용으로 저장` 후 저장 기록과 상세 메뉴를 볼 수 있다.
- [ ] `사이트 화면 미리보기`에서 폴란드어·영어·한국어 화면이 열린다.
- [ ] 로그아웃한 뒤 같은 Google 계정으로 다시 로그인할 수 있다.
- [ ] 실제 공개 사이트와 도메인에는 변화가 없다.

## 8. Google 로그인만 허용하도록 마무리

아래 작업은 **위 E2E 확인에서 Google owner 로그인이 성공하고, Authentication → Users의 Google 사용자 UID가 `admin_users`의 활성 owner UID와 같은 것을 확인한 뒤에만** 진행합니다. 먼저 Email 로그인을 끄면 운영 화면에 들어가지 못할 수 있습니다.

1. Supabase Authentication → Sign In / Providers → Email에서 Email provider를 끕니다.
2. Authentication → Sessions에서 기존 세션을 종료합니다. 화면 구성이 다르면 기존 이메일 로그인 사용자를 로그아웃시키거나 세션을 폐기하는 기능을 사용합니다.
3. 현재 브라우저에서도 운영툴에서 로그아웃합니다.
4. `http://127.0.0.1:3000/admin/`을 다시 열어 Google 로그인 버튼만 보이고, owner Google 계정으로 다시 로그인되는지 확인합니다.

기존 Auth 사용자는 삭제하지 않습니다. Google identity가 같은 UID에 연결되었는지 먼저 확인해야 메뉴 권한과 저장 기록 연결이 유지됩니다.

마지막 Google 세션 보안 migration까지 적용하면 화면 설정과 별개로 데이터베이스도 `session_id`, OAuth 인증 방법, Google identity를 함께 확인합니다. 비밀번호·이메일 OTP 세션으로 같은 UID를 사용해도 운영 권한을 얻을 수 없습니다. 토큰 새로고침과 점검 근거는 [운영툴 Google 로그인 보안 경계](admin-auth-security.md)에 정리되어 있습니다.

## 9. Secret key 제거하고 보관

seed와 `verify:supabase`가 끝나면 `.env.local`에서 다음 초기 설정용 값을 제거합니다.

```text
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_OWNER_USER_ID
```

Secret key가 다시 필요하면 Supabase에서 새 키를 발급받아 본인이 직접 입력합니다. 따로 보관해야 한다면 승인된 비밀번호 관리 앱이나 비밀 저장소만 사용합니다. 노출이 의심되면 즉시 기존 키를 폐기하고 새 키를 발급합니다.

앱 실행에는 아래 두 공개 값만 남기면 됩니다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

값을 지운 뒤 개발 서버를 다시 시작하고 로그인이 되는지 한 번 더 확인합니다.

## 권한 역할

| 역할 | 할 수 있는 일 |
| --- | --- |
| 최고 관리자 (`owner`) | 모든 메뉴 작업과 운영자 권한 관리 |
| 메뉴 관리자 (`manager`) | 메뉴·카테고리·사진 수정, 순서 변경, 확인용 저장 |
| 매장 직원 (`staff`) | 메뉴 확인, 판매 중·품절 변경 |

### 새 운영자를 추가하는 방법

1. 새 운영자가 자신의 Google 계정으로 운영툴 로그인을 한 번 시도합니다.
2. 화면에 운영자 승인 요청을 보냈다는 안내가 나오면 기존 최고 관리자에게 알립니다.
3. 최고 관리자는 `/admin/operators/`의 `운영자 관리`에서 역할을 선택해 승인합니다.
4. 새 운영자가 다시 Google로 로그인하면 선택한 권한으로 운영툴을 사용할 수 있습니다.

필요 없는 요청은 `요청 거절`로 정리할 수 있으며, 같은 사용자가 나중에 다시 Google 로그인하면 새 요청을 보낼 수 있습니다. Supabase Authentication의 전체 사용자를 자동으로 보여주지 않습니다. 운영툴에 직접 로그인을 시도해 승인 요청을 보낸 Google 계정만 목록에 나타납니다. 현재 로그인한 최고 관리자는 자신의 권한을 낮추거나 이용 중지할 수 없으며, 활성 최고 관리자는 항상 최소 1명 유지됩니다.

- 사람마다 별도 계정을 사용하고 공용 비밀번호를 나눠 쓰지 않습니다.
- 일을 그만둔 운영자는 운영툴의 `운영자 관리`에서 이용을 중지합니다. Google 계정 자체를 삭제할 필요는 없습니다.
- 메뉴 사진 버킷은 공개용입니다. 개인정보나 내부 문서를 업로드하지 않습니다.

## 저장과 사이트 공개의 차이

- 메뉴 관리 화면의 변경 내용은 Supabase에 저장됩니다.
- `확인용으로 저장`은 그 시점의 메뉴 상태를 따로 보관할 뿐입니다.
- 품절 상태 외의 이름·가격·사진·순서 변경은 승인된 별도 사이트 빌드가 있어야 공개 사이트에 반영됩니다.
- 이 문서의 어떤 명령도 GitHub Pages 배포나 도메인 변경을 실행하지 않습니다.
