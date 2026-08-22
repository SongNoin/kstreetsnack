# 운영툴에서 GitHub Pages에 메뉴 공개하기

운영툴의 브라우저에는 GitHub 토큰이나 Supabase 비밀 키를 넣지 않습니다. 공개 흐름은 아래처럼 동작합니다.

1. 메뉴 관리자 또는 최고 관리자가 현재 메뉴를 변경 불가능한 `menu_releases` 확인용 저장본으로 만듭니다. 이 단계에서는 이름·가격·사진·메뉴 구성은 공개 사이트에서 바뀌지 않습니다.
2. 운영툴이 로그인 토큰과 저장본 ID만 Supabase `menu-deploy` Edge Function에 보냅니다.
3. Edge Function의 데이터베이스 RPC가 최고 관리자 여부와 현재 저장본 여부를 다시 확인합니다.
4. Edge Function 안에만 보관한 GitHub 토큰으로 Pages workflow를 시작합니다.
5. workflow는 전달받은 저장본 ID를 사용해 **그 저장본만** 정적 HTML로 만듭니다.
6. Pages 배포 성공 callback을 데이터베이스가 받은 뒤에만 `live_release_id`가 그 저장본으로 바뀝니다. Pages 빌드나 배포가 실패하면 이름·가격·사진·메뉴 구성은 기존 공개본을 유지합니다.
7. 성공·실패 상태와 GitHub 실행 링크가 Supabase에 기록되어 운영툴에서 확인할 수 있습니다.

요청마다 별도의 UUID가 생기므로 이전 workflow의 늦은 응답이 새 배포 상태를 덮어쓸 수 없습니다. 데이터베이스는 서로 다른 확인용 저장본을 포함해 최고 관리자 공개 요청을 한 번에 하나만 허용합니다. GitHub 요청 응답이 끊기면 `대기` 상태에만 적용되는 원자적 실패 처리와 workflow의 `진행 중` callback이 같은 행 잠금을 두고 경쟁하므로, 뒤늦은 실패가 이미 시작한 workflow를 덮어쓰지 않습니다. 시작하지 못한 `대기` 요청은 45분 뒤 운영툴에서 다시 확인·요청할 수 있고, 이미 `진행 중`이던 요청은 Edge Function이 GitHub 실행 결과를 조회해 실제 Pages 배포 단계의 성공·실패와 먼저 맞춘 뒤에만 다시 요청합니다.

GitHub Pages 배포와 Supabase 상태 callback은 하나의 원자적 트랜잭션이 아닌 두 외부 시스템의 작업입니다. 그래서 Pages 배포는 성공했지만 최종 callback이 재시도 후에도 장시간 실패하면, 정적 사이트에는 새 저장본이 보이는데 데이터베이스의 `live_release_id`는 이전 저장본을 가리키는 일시적 불일치가 생길 수 있습니다. 이때 workflow는 실패로 표시됩니다. 이 상태에서 뒤따르는 일반 push·주간 재빌드는 `queued`/`running` 요청을 확인하고 실패 종료하므로 이전 공개본으로 사이트를 되돌리지 않습니다. 45분 뒤 최고 관리자가 다시 요청하면 Edge Function은 전체 workflow 결론이 아니라 `Deploy to GitHub Pages` 단계 결과를 확인하여 이미 공개된 저장본을 먼저 `succeeded`로 복구합니다. 그 뒤 필요하면 같은 저장본을 다시 배포하므로 늦은 callback이나 취소된 실행이 새 요청 상태를 덮지 않습니다.

품절·재판매 상태는 매장 대응 속도를 위해 예외적으로 배포를 기다리지 않고 공개 메뉴에 즉시 반영됩니다. 공개 페이지는 익명 사용자에게 읽기만 허용된 `menu_availability`의 `menu_item_id`와 `is_available` 값을 덧씌우며, 이름·가격·사진·카테고리·보관 상태는 이 경로로 바꿀 수 없습니다. 따라서 확인용 저장본과 `live_release_id`는 카탈로그 변경 승인 경계이고, 품절 토글은 실시간 운영 경계입니다.

## 1. 데이터베이스 반영

다음 migration을 순서대로 Supabase에 반영합니다.

```text
supabase/migrations/20260822000000_add_menu_deployment_pipeline.sql
supabase/migrations/20260822010000_add_live_menu_release.sql
supabase/migrations/20260822040000_add_queued_deployment_failure_cas.sql
```

이 migration은 다음을 추가합니다.

- `menu_releases`의 `queued`, `running`, `succeeded`, `failed` 배포 상태
- 공개 요청된 상태(`queued`, `running`, `succeeded`)의 정확한 저장본만 빌드하는 `get_menu_release(release_id)`
- 최고 관리자만 사용할 수 있는 `request_menu_deployment(...)`
- Edge Function만 사용할 수 있는 `update_menu_deployment(...)`
- GitHub 요청 응답 유실 때 `queued` 상태만 실패로 바꾸는 `fail_queued_menu_deployment(...)`
- 최신 확인용 저장본인 `current_release_id`와 실제 공개본인 `live_release_id`의 분리
- 배포가 처음 `succeeded`로 바뀔 때만 공개본을 승격하는 데이터베이스 trigger
- 공개 RPC가 `schema_version`, `published_at`, `groups`만 반환하는 최소 공개 projection
- 미해결 공개 요청이 있으면 일반 push·주간 재빌드가 이전 공개본을 배포하지 못하게 하는 fail-closed RPC
- UUID를 알아도 공개 요청 전·실패 상태의 확인용 저장본은 익명 조회할 수 없는 상태 제한
- 승인되지 않은 로그인 사용자는 운영 메모와 변경 시각을 읽지 못하게 하는 availability RLS
- 승인된 사진을 같은 Storage 경로에서 덮어쓰거나 삭제하지 못하게 하는 정책
- 공개 메뉴가 읽기 전용 품절 상태만 실시간으로 덧씌우는 하이브리드 동작

기존 메뉴 저장본과 `snapshot`은 수정하지 않습니다.

## 2. GitHub 저장소 설정

GitHub 저장소의 Settings → Secrets and variables → Actions에 아래 값을 추가합니다.

### Variables

| 이름 | 값 | 공개 여부 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | 정적 사이트에 포함되는 공개 값 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | RLS 적용을 받는 공개 값 |

### Secret

| 이름 | 값 |
| --- | --- |
| `MENU_DEPLOY_CALLBACK_SECRET` | 32바이트 이상의 무작위 문자열 |

callback secret은 Supabase Edge Function에도 **같은 값**을 넣습니다. 공개 키와 달리 소스나 화면 캡처에 노출하지 않습니다.

workflow는 운영툴 배포일 때 `release_id`와 `deployment_request_id`를 필수 입력으로 받습니다. 일반 코드 push와 주간 재빌드는 승인된 `live_release_id`만 사용하되, `queued` 또는 `running` 공개 요청이 하나라도 남아 있으면 빌드를 중단합니다. 이 안전장치는 Pages 배포 성공 뒤 최종 callback만 실패한 경우에도 다음 자동 실행이 이전 공개본을 다시 올리는 일을 막습니다. 모든 Pages 실행은 하나의 `pages` concurrency group에서 `queue: max`로 직렬화되어, 실행 중인 배포 뒤에 최대 100개가 취소되지 않고 기다립니다. 따라서 뒤늦은 push나 주간 실행이 최고 관리자 요청을 대기열에서 교체하지 않습니다. 모든 GitHub Pages 빌드는 `REQUIRE_REMOTE_MENU=1`로 실행되므로 Supabase 변수·연결·공개본이 없거나 응답이 잘못되면 빌드를 중단하며, 저장소의 초기 메뉴를 대신 공개하지 않습니다.

workflow가 사용하는 공식 GitHub Actions는 가변 major tag가 아니라 검증한 전체 commit SHA로 고정하며, 빌드 작업에는 읽기 권한만, 실제 배포 작업에만 `pages: write`와 `id-token: write`를 부여합니다.

## 3. GitHub 전용 토큰 만들기

GitHub fine-grained personal access token을 이 저장소 하나에만 허용하고 Repository permissions의 **Actions: Read and write**만 부여합니다. 이 토큰은 Supabase Edge Function secret으로만 저장합니다.

권장 만료일을 설정하고 만료 전에 교체합니다. GitHub 계정 비밀번호나 광범위한 classic token은 사용하지 않습니다.

## 4. Supabase Edge Function secret

Supabase Dashboard의 Edge Functions secret 설정 또는 Supabase CLI로 다음 값을 넣습니다.

| 이름 | 예시/설명 |
| --- | --- |
| `GITHUB_ACTIONS_TOKEN` | 위에서 만든 fine-grained token |
| `GITHUB_REPOSITORY` | `SongNoin/kstreetsnack` |
| `GITHUB_WORKFLOW_FILE` | 선택 사항, 기본값 `deploy-pages.yml` |
| `GITHUB_WORKFLOW_REF` | 선택 사항, 기본값 `master` |
| `MENU_DEPLOY_CALLBACK_SECRET` | GitHub Secret과 같은 무작위 값 |
| `ADMIN_ALLOWED_ORIGINS` | 운영툴을 여는 HTTPS origin들을 쉼표로 구분 |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 호스팅된 Edge Function에 기본 제공합니다. `SUPABASE_SERVICE_ROLE_KEY`와 GitHub token은 절대 `NEXT_PUBLIC_` 이름으로 만들지 않습니다.

여러 도메인에서 운영툴을 열 경우 `ADMIN_ALLOWED_ORIGINS`에 경로 없이 origin만 입력합니다.

```text
https://example.com,https://www.example.com
```

메뉴 관리자는 메뉴를 수정하고 `확인용 저장본`을 만들 수 있지만 실제 사이트 공개 요청은 최고 관리자만 할 수 있습니다. 이 권한은 화면뿐 아니라 데이터베이스 RPC에서도 다시 검사합니다.

## 5. Edge Function 올리기

함수 파일은 아래에 있습니다.

```text
supabase/functions/menu-deploy/index.ts
```

`supabase/config.toml`에서 이 함수의 gateway JWT 확인을 끈 이유는 사용자 요청과 GitHub callback을 같은 함수가 받기 때문입니다. 함수 내부에서는 사용자 요청을 Supabase RPC로 다시 인증하고, callback은 별도의 강한 secret으로 검증합니다.

실제 프로젝트에 연결된 Supabase CLI에서 함수를 배포합니다. 연결한 프로젝트 ref를 먼저 다시 확인하고 운영 데이터베이스 초기화 명령은 실행하지 않습니다.

첫 메뉴 변경을 공개하기 전에 현재 `live_release_id`와 같은 기존 공개본으로 한 번 배포 요청을 실행해 callback 경로를 점검합니다. Supabase Dashboard의 배포된 `menu-deploy` 함수에서 gateway의 **Verify JWT가 꺼져 있는지**, GitHub와 Edge Function의 callback secret이 같은지, 실행 상태가 `대기 → 진행 중 → 공개 완료`로 끝나는지 확인합니다. 이 기준 공개본 점검이 성공하기 전에는 변경된 메뉴 저장본을 공개하지 않습니다.

## 6. 공개 전 점검

- [ ] 새 migration이 적용됐다.
- [ ] 배포된 `menu-deploy` 함수의 gateway **Verify JWT**가 꺼져 있다.
- [ ] Edge Function 필수 secret 네 항목과 필요한 선택 항목이 정확하다.
- [ ] GitHub Variables 두 항목과 callback Secret이 정확하다.
- [ ] `MENU_DEPLOY_CALLBACK_SECRET`이 GitHub와 Supabase에서 같다.
- [ ] GitHub token이 이 저장소의 Actions 권한만 가진다.
- [ ] 기존 공개본으로 첫 배포를 실행해 callback 상태가 `대기 → 진행 중 → 공개 완료`로 끝났다.
- [ ] 최고 관리자가 아닌 계정의 공개 요청은 거절된다.
- [ ] 배포가 실행 중일 때 추가 push·주간 실행·공개 요청이 기존 대기 실행을 취소하지 않고 같은 Pages 대기열에서 순서대로 처리된다.
- [ ] 공개 요청 후 상태가 `대기 → 진행 중 → 공개 완료`로 변한다.
- [ ] 확인용 저장만 했을 때 `live_release_id`와 사이트의 이름·가격·사진·메뉴 구성이 바뀌지 않는다.
- [ ] 품절·재판매 토글은 별도 사이트 배포 없이 공개 메뉴에 반영되고, 익명 사용자는 해당 상태를 수정할 수 없다.
- [ ] 성공 callback 뒤에만 `live_release_id`가 요청한 저장본으로 바뀐다.
- [ ] Supabase 값을 임시로 누락한 검증 workflow가 fallback 배포 대신 실패한다.
- [ ] 실패 시 GitHub 실행 링크와 실패 안내가 보인다.
- [ ] 45분 이상 멈춘 대기·진행 상태는 새로고침 뒤에도 최고 관리자에게 `상태 확인 / 다시 요청` 버튼이 보인다.
- [ ] GitHub 빌드 로그에서 `MENU_RELEASE_ID`가 요청한 저장본 UUID다.
- [ ] 사이트의 메뉴 이름·가격·사진·구성은 해당 저장본과 같고, 품절 상태는 현재 운영 상태와 같다.

## 복구 원칙

잘못 공개했다면 GitHub 아티팩트를 임의로 고치는 대신, 운영툴에서 검증된 메뉴 상태를 새 저장본으로 만든 뒤 다시 공개합니다. 저장본 ID 고정 빌드라서 배포 도중 다른 운영자가 이름·가격·사진·구성을 바꿔도 진행 중인 사이트 결과가 달라지지 않습니다. 품절·재판매는 실시간 운영 상태이므로 복구 작업에서 되돌리는 즉시 공개 메뉴에도 반영됩니다.
