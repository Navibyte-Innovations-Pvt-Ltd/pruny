## [1.44.7](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/compare/v1.44.6...v1.44.7) (2026-04-30)


### Bug Fixes

* **fixer:** enhance declaration regex to support TypeScript type annotations ([b46ef1a](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/b46ef1a4e3fe18d3565948660e03eceaca46d832))

## [1.44.6](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/compare/v1.44.5...v1.44.6) (2026-04-30)


### Bug Fixes

* **fixer:** stop brace leak from multi-line template literals with ${...} in deleteDeclaration ([9d9a251](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/9d9a2517f5143e775de61be6cb45073bdf1f931d))

## [1.44.5](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/compare/v1.44.4...v1.44.5) (2026-04-30)


### Bug Fixes

* **fixer:** track bracket depth in deleteDeclaration to fully delete array-of-objects exports ([606f5f2](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/606f5f290022953ec4d13218584d82e72b91992d))
* **unused-exports:** detect JSX component usage as internal reference in makeCodePattern ([7deb6ce](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/7deb6ce39ad39e7b48d582c82fb2a621a3c3424c))

## [1.44.4](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/compare/v1.44.3...v1.44.4) (2026-04-30)


### Bug Fixes

* **cli:** exit after one cycle in --cleanup mode to prevent infinite fix loop ([b8962ff](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/b8962fff85e9b68240ba2a7bae5d4cca0495fb90))
* **fixer:** handle block exports and template literal brace counting in removeExportFromLine ([fde0f98](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/fde0f98fb628bf7c36c25240458f57a995ac0fcf))
* **unused-exports:** detect exports used internally but never imported externally ([7363f80](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/7363f80d193a3a9991f4a82f8865a24979004721))

## [1.44.3](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/compare/v1.44.2...v1.44.3) (2026-04-30)


### Bug Fixes

* **handleFixes:** track modifications to routes, exports, and files for cascading scans ([9594a19](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/9594a195b341440ec66949770bd2c42f5ddfba00))

## [1.44.2](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/compare/v1.44.1...v1.44.2) (2026-04-30)


### Bug Fixes

* **cli:** show report by default, require --fix for interactive cleanup menu ([5c82ef8](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/5c82ef8bb4f5dc0b03a70ddd6bca213ea94c923e))

## [1.44.1](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/compare/v1.44.0...v1.44.1) (2026-04-29)


### Bug Fixes

* **broken-links:** treat template-literal placeholders as wildcards + skip runtime-generated public assets ([4135a9b](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/4135a9b1965c9a02294bce85676cdba92b8970b2))

# [1.44.0](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/compare/v1.43.10...v1.44.0) (2026-04-29)


### Bug Fixes

* **cli:** skip clean apps in --all --fix mode so menu opens only for apps with issues ([f0bff10](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/f0bff107843a2d04e7dc87501f7c77239b86fdb7))
* **publish:** replace PAT_TOKEN with GH_TOKEN for authentication ([cb3b879](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/cb3b879d93eab6d8c87ae4bd676753f96d01a7cb))
* **repository:** update GitHub URL to reflect new organization ([23b11c8](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/23b11c8db50cec2f7685d774a5314705340e5c4a))


### Features

* **broken-links:** resolve generateStaticParams to validate concrete slug links ([e04d324](https://github.com/Navibyte-Innovations-Pvt-Ltd/pruny/commit/e04d324c178ac9baa5de555c08fa7d959438da58))

## [1.43.10](https://github.com/webnaresh/pruny/compare/v1.43.9...v1.43.10) (2026-04-22)


### Bug Fixes

* **broken-links:** capture template-literal paths + filter gitignore negation patterns ([0a28bbe](https://github.com/webnaresh/pruny/commit/0a28bbebe552d27042ed6272867b7e9c156c51d9))

## [1.43.9](https://github.com/webnaresh/pruny/compare/v1.43.8...v1.43.9) (2026-04-15)


### Bug Fixes

* **scanner:** keep ignore.files in referenceFiles for export usage checks ([e0a8b18](https://github.com/webnaresh/pruny/commit/e0a8b18fb22de89084b3947f943686c56ff3d9ac))
* **scanner:** trace imports through ignore.files entries for reachability ([d1fb963](https://github.com/webnaresh/pruny/commit/d1fb96316f3b67d592f8635e30ae9f7c03c51d9a))
* **tsconfig:** make JSONC comment stripper string-literal aware ([145637b](https://github.com/webnaresh/pruny/commit/145637b8d5356c1cf17a6e52cdef47a69c3bb5f3))

## [1.43.8](https://github.com/webnaresh/pruny/compare/v1.43.7...v1.43.8) (2026-04-14)


### Bug Fixes

* **scanner:** handle webpack magic comments in dynamic import() paths ([64b773e](https://github.com/webnaresh/pruny/commit/64b773eb31e3c2fdf7f58e1fe908d418a29d82ca))

## [1.43.7](https://github.com/webnaresh/pruny/compare/v1.43.6...v1.43.7) (2026-04-10)


### Bug Fixes

* **broken-links:** auto-skip links matching gitignored public file patterns ([7b849db](https://github.com/webnaresh/pruny/commit/7b849db85b4f30e7992546f398b95bff29e6d1ce)), closes [#36](https://github.com/webnaresh/pruny/issues/36)

## [1.43.6](https://github.com/webnaresh/pruny/compare/v1.43.5...v1.43.6) (2026-04-10)


### Bug Fixes

* **broken-links:** check public/ directory before flagging link as broken ([b4a28ec](https://github.com/webnaresh/pruny/commit/b4a28ec6ed9ad05e9bcc9ad784f8d3e7c492351c)), closes [#36](https://github.com/webnaresh/pruny/issues/36)

## [1.43.5](https://github.com/webnaresh/pruny/compare/v1.43.4...v1.43.5) (2026-04-04)


### Bug Fixes

* **scanner:** prevent NestJS route false positives when Next.js replacement routes exist in monorepo ([797e6f9](https://github.com/webnaresh/pruny/commit/797e6f95d2b9cd1436f7fa7653821ecaf5745a5a))

## [1.43.4](https://github.com/webnaresh/pruny/compare/v1.43.3...v1.43.4) (2026-04-04)


### Bug Fixes

* **patterns:** prevent dedup from suppressing different API paths within same regex span ([f821411](https://github.com/webnaresh/pruny/commit/f821411008c2fb4e0047197c0333c6a6dc2b74ea))

## [1.43.3](https://github.com/webnaresh/pruny/compare/v1.43.2...v1.43.3) (2026-04-04)


### Bug Fixes

* **patterns:** add source field to ApiReference to distinguish HTTP client calls from generic string matches ([109d886](https://github.com/webnaresh/pruny/commit/109d8866c79fa5aa37e18d91734de7cc1ec09411))
* **scanner:** filter NestJS route usage to HTTP client references only, and flag empty controllers ([3ff5a47](https://github.com/webnaresh/pruny/commit/3ff5a4776a61350d113497cefaa796fd3a1ea6bb))

## [1.43.2](https://github.com/webnaresh/pruny/compare/v1.43.1...v1.43.2) (2026-04-04)


### Bug Fixes

* **patterns:** detect /api/ paths inside multiline template literals (XML/HTML builders) ([8df87a5](https://github.com/webnaresh/pruny/commit/8df87a5b36be606d47366f22b9660e8277aa66d0))

## [1.43.1](https://github.com/webnaresh/pruny/compare/v1.43.0...v1.43.1) (2026-04-02)


### Bug Fixes

* **config:** add ios and android to default ignored folders for React Native apps ([185bb01](https://github.com/webnaresh/pruny/commit/185bb01f6b3fc57ae14ceff9fbabdd78e3cc910d))

# [1.43.0](https://github.com/webnaresh/pruny/compare/v1.42.1...v1.43.0) (2026-04-02)


### Bug Fixes

* **broken-links:** exclude Expo/RN app files from reference scanning to prevent false broken link reports ([2d940b6](https://github.com/webnaresh/pruny/commit/2d940b6a8c43365a1a61fbdd3c73f5ae86f5a6d2))
* **unused-files:** add Expo Router entry patterns so RN app files are not falsely flagged as unused ([18d2c5a](https://github.com/webnaresh/pruny/commit/18d2c5a2eba6e04b2275652e3bf6d5f52fecf268))


### Features

* **utils:** add detectAppFramework() to identify Expo/RN/Next.js/NestJS apps from package.json ([22db049](https://github.com/webnaresh/pruny/commit/22db0498102778941345ff130f24b0eca1b14428))

## [1.42.1](https://github.com/webnaresh/pruny/compare/v1.42.0...v1.42.1) (2026-03-27)


### Bug Fixes

* **constants:** add middleware and proxy to ignored export names for Next.js framework files ([2646bd1](https://github.com/webnaresh/pruny/commit/2646bd10f0274471748a6045b0fe8a05e7e82150))

# [1.42.0](https://github.com/webnaresh/pruny/compare/v1.41.0...v1.42.0) (2026-03-19)


### Features

* **index:** show unused item names in compact grouped list after summary table ([9a306cd](https://github.com/webnaresh/pruny/commit/9a306cd7af8f2a018edf676bdaa32b3a1535979a))

# [1.41.0](https://github.com/webnaresh/pruny/compare/v1.40.0...v1.41.0) (2026-03-18)


### Bug Fixes

* **broken-links:** require literal segment in dynamic suffix tail to prevent false matches ([#25](https://github.com/webnaresh/pruny/issues/25)) ([b848ce9](https://github.com/webnaresh/pruny/commit/b848ce993d277f22221a2d2c4d14fffb1850d8c6))


### Features

* **summary:** always show Internal Links row in summary table when links are scanned ([ba444f3](https://github.com/webnaresh/pruny/commit/ba444f31887654198e0542fac507fef63d726e15))
* **types:** add scanned count to BrokenLinksResult for summary table visibility ([0b4e0e3](https://github.com/webnaresh/pruny/commit/0b4e0e389e3e42e690f4094cc77e758236e714fc))

# [1.40.0](https://github.com/webnaresh/pruny/compare/v1.39.1...v1.40.0) (2026-03-15)


### Features

* **scanner:** detect API routes referenced in GitHub Actions workflow files ([8c61f97](https://github.com/webnaresh/pruny/commit/8c61f9784be8b6b8759b05bef7a84cbf6ee2063e))

## [1.39.1](https://github.com/webnaresh/pruny/compare/v1.39.0...v1.39.1) (2026-03-15)


### Bug Fixes

* **scanner:** use app-specific dir for vercel.json lookup and include dot-directories in source scan ([1b12a90](https://github.com/webnaresh/pruny/commit/1b12a90e2e83dd7cae0c4dcaeebdc08d68060f46))

# [1.39.0](https://github.com/webnaresh/pruny/compare/v1.38.0...v1.39.0) (2026-03-15)


### Bug Fixes

* **constants:** sync DEFAULT_IGNORE with config defaults, add out, .cache, .vercel, .husky, .swc, storybook-static ([a52c653](https://github.com/webnaresh/pruny/commit/a52c653385c42da41cefa5ea1ff452e785cf994f))


### Features

* **config:** add .turbo, .cache, .vercel, .husky, .swc, generated, storybook-static to default ignored folders ([0af80d7](https://github.com/webnaresh/pruny/commit/0af80d7bb0dc7b2163da3942cc5d004ce0ca955f))
* **scanner:** auto-detect external routes from vercel.json rewrites/redirects and package.json deps (next-auth, inngest) ([242315b](https://github.com/webnaresh/pruny/commit/242315bad8008ca3cd7be70d1482da982d437608))
* **types:** expand VercelConfig with rewrites and redirects interfaces ([2a4b74a](https://github.com/webnaresh/pruny/commit/2a4b74a9071061ea9386ade666b2be4b79b65a68))
* **unused-files:** add mdx-components.tsx as Next.js convention entry point ([1c681f7](https://github.com/webnaresh/pruny/commit/1c681f798fa7e1d013f4d8d4aaac9ed9c652a270))
* **unused-files:** use tsconfig paths for import resolution, add storybook/seed/prisma entry points ([95868d8](https://github.com/webnaresh/pruny/commit/95868d8129ffc0089f000f2c87a90b8166486e70))
* **utils:** add parseTsConfigPaths for tsconfig.json path alias resolution in unused-files scanner ([c7f097b](https://github.com/webnaresh/pruny/commit/c7f097bae570f090f0c384c465f67a590981eee8))

# [1.38.0](https://github.com/webnaresh/pruny/compare/v1.37.0...v1.38.0) (2026-03-13)


### Bug Fixes

* **scanner:** resolve false positive broken links for multi-tenant subdomain routes ([60786f2](https://github.com/webnaresh/pruny/commit/60786f240cb098dcd82244972f5b722c9069124a))


### Features

* **config:** load, merge, and deduplicate ignore.links from config files ([8f43e11](https://github.com/webnaresh/pruny/commit/8f43e117090d0731e4ec495e56c6e77339f24e86))
* **types:** add links array to IgnoreConfig for broken link suppression ([877982a](https://github.com/webnaresh/pruny/commit/877982ab280439a1dcfccf39510e9905601f4454))

# [1.37.0](https://github.com/webnaresh/pruny/compare/v1.36.1...v1.37.0) (2026-03-13)


### Features

* **cli:** add broken links to report, summary table, fix menu, dry run, and filter ([3759d46](https://github.com/webnaresh/pruny/commit/3759d46f18481abbca05160da1f03f7257837399))
* **scanner:** integrate broken links scanner into scan orchestrator ([303be2e](https://github.com/webnaresh/pruny/commit/303be2e86a06905649c3e99f0984af3521c6d4c3))
* **scanners:** add broken internal links scanner to detect references to non-existent pages ([b5aa90f](https://github.com/webnaresh/pruny/commit/b5aa90f5bc43ba040470b4adc5a8d9fe60bb2279))
* **types:** add BrokenLink interface and brokenLinks to ScanResult ([2efca28](https://github.com/webnaresh/pruny/commit/2efca2894a10993e0c643d490f4f432b823cc814))

## [1.36.1](https://github.com/webnaresh/pruny/compare/v1.36.0...v1.36.1) (2026-03-13)


### Bug Fixes

* populate dry run report for files, assets, and missing-assets selections ([2c7b69d](https://github.com/webnaresh/pruny/commit/2c7b69d762d55ada5b6fe3b4c3158cf11ca16d86))

# [1.36.0](https://github.com/webnaresh/pruny/compare/v1.35.0...v1.36.0) (2026-02-25)


### Bug Fixes

* update health check status from 'ok2' to 'ok' ([6f4a8ef](https://github.com/webnaresh/pruny/commit/6f4a8ef4ec61b0d1b4997c6b5bd1d7f0f200dd79))


### Features

* add llms.txt to public asset scanner ignore list ([ddaf32e](https://github.com/webnaresh/pruny/commit/ddaf32e926fb8f3225432f2f6a8bc5944c04f78a))

# [1.35.0](https://github.com/webnaresh/pruny/compare/v1.34.1...v1.35.0) (2026-02-25)


### Features

* add test script and include bun test in validate pipeline ([6eb2ac4](https://github.com/webnaresh/pruny/commit/6eb2ac43ed209e1e6a633c877a8cc5d3b4afd5f6))

## [1.34.1](https://github.com/webnaresh/pruny/compare/v1.34.0...v1.34.1) (2026-02-25)


### Bug Fixes

* Adjust package configuration to point `pruny` binary to `dist/index.js` and remove `bin` from published files. ([9e3910d](https://github.com/webnaresh/pruny/commit/9e3910db9bfda3090e23656d3123295259bba34b))

# [1.34.0](https://github.com/webnaresh/pruny/compare/v1.33.1...v1.34.0) (2026-02-25)


### Features

* add bug report issue template ([948849e](https://github.com/webnaresh/pruny/commit/948849e75d5b5b8e891ad328988f5f0fc3864f42))
* add feature request issue template ([5d5890a](https://github.com/webnaresh/pruny/commit/5d5890a5e903e5a80213ee2fd8b8b8ae2ad10f3f))
* add issue template config with discussions link ([e785ae4](https://github.com/webnaresh/pruny/commit/e785ae4cfd7839899146b18a2e9d3946a544bc45))

## [1.33.1](https://github.com/webnaresh/pruny/compare/v1.33.0...v1.33.1) (2026-02-25)


### Bug Fixes

* skip all Next.js metadata convention files in missing assets scanner ([f9aaf97](https://github.com/webnaresh/pruny/commit/f9aaf97208680dcc9d7bcaa1214f99b1f9678eaa))

# [1.33.0](https://github.com/webnaresh/pruny/compare/v1.32.0...v1.33.0) (2026-02-25)


### Features

* skip Next.js metadata convention files in missing assets scanner ([6940c50](https://github.com/webnaresh/pruny/commit/6940c50a801bfb3a368ca27bd77ebdbe1b889e66))

# [1.32.0](https://github.com/webnaresh/pruny/compare/v1.31.0...v1.32.0) (2026-02-24)


### Features

* Add non-interactive mode detection to skip prompts and print reports directly in CI/piped environments. ([26aedee](https://github.com/webnaresh/pruny/commit/26aedee1b28fe202b50418d7d8e01ba79158581e))

# [1.31.0](https://github.com/webnaresh/pruny/compare/v1.30.0...v1.31.0) (2026-02-16)


### Features

* show missing asset file paths in summary and count them as issues ([0ae5122](https://github.com/webnaresh/pruny/commit/0ae5122ebbd2c3b06045e8e2114ee86dbc621c8d))

# [1.30.0](https://github.com/webnaresh/pruny/compare/v1.29.0...v1.30.0) (2026-02-16)


### Features

* add interactive fix menu for single project mode and clean up summary table ([3ed85c5](https://github.com/webnaresh/pruny/commit/3ed85c5c7a383cf24d992060f1fbf86940b9d510))

# [1.29.0](https://github.com/webnaresh/pruny/compare/v1.28.1...v1.29.0) (2026-02-16)


### Bug Fixes

* check if service methods are used elsewhere before cascading deletion ([d6eb507](https://github.com/webnaresh/pruny/commit/d6eb5079ced2e0737af69c4c4ea54ca2e3922994))
* Compare relative paths when checking external usage in the unused exports scanner. ([7db5675](https://github.com/webnaresh/pruny/commit/7db567522bbd20520e5914f6a48979557dc7b8b1))
* filter controller methods from unused exports scanner results ([0da3b95](https://github.com/webnaresh/pruny/commit/0da3b95373fce035bdff2c1a806509b205a5722a))
* improve cascading deletion by verifying service method usage in controllers ([932c21b](https://github.com/webnaresh/pruny/commit/932c21b8afdde2869d59b4d685baca810d7f604c))
* improve line number and decorator start detection in fixer by using regex word boundaries and tracking parenthesis/brace depth for multi-line decorators. ([126cc2f](https://github.com/webnaresh/pruny/commit/126cc2fd07ef19eed7babc77ec416ad8b2db8617))
* Improve method definition parsing by tracking parentheses and enhance URL path extraction to cover full URLs. ([d0bf737](https://github.com/webnaresh/pruny/commit/d0bf737d850b69729d2a9e9cc118c3ed686e35ff))
* mark routes as used when all unused methods are removed ([4bdbc51](https://github.com/webnaresh/pruny/commit/4bdbc51da34a26bdf828d92bd3070709d0cdc183))
* prevent cascading deletion of service methods used elsewhere ([9739cbb](https://github.com/webnaresh/pruny/commit/9739cbb27206c2033315e2fdb93e5f4ea63b5a31))
* prevent cleanupStructure from removing valid interface/enum closing braces ([fc2b274](https://github.com/webnaresh/pruny/commit/fc2b2748990109cefb189832b993e9c6d1ec450a))
* prevent false multi-line template literal matches in pattern scanner ([27eca2f](https://github.com/webnaresh/pruny/commit/27eca2fb51c1e722e165717fa0ff0dde9df99a3e))
* Prevent false positive route method deletion and improve file path resolution by using `appSpecificScan.rootDir`. ([84b11b5](https://github.com/webnaresh/pruny/commit/84b11b5b60898dc80924004104340db39346c25f))
* Prevent multi-line matches in template literal regex patterns by excluding newlines from capture groups. ([6ca5679](https://github.com/webnaresh/pruny/commit/6ca56792b101c35d073697a763cbb23c52272d69))
* resolve route fix no-op and Lambda false positives ([15d426f](https://github.com/webnaresh/pruny/commit/15d426f76ea2e0d3dc70df72f90f9c28ae5bcaf1))
* Simplify the display of unused assets by removing conditional `chalk` styling. ([fda4bca](https://github.com/webnaresh/pruny/commit/fda4bca7f497c81a14a61f7d26bfa3e42a19707c))
* support class/interface/type/enum deletion in export fixer ([4bd2b4b](https://github.com/webnaresh/pruny/commit/4bd2b4bee89dd49fa7b7d13a17bfc1251b6f581c))
* support class/interface/type/enum deletion in export fixer ([91f6885](https://github.com/webnaresh/pruny/commit/91f68857b137ea2d4a5bf44c3bfa589e27b1e1d1))


### Features

* add `--all` flag for CI-friendly non-interactive scanning ([3e01afc](https://github.com/webnaresh/pruny/commit/3e01afc6e16c30ec35b8e5001ff859b958b0ccb8))
* Add `--app` and `--cleanup` CLI options for targeted scanning and cleanup, updating the `CliOptions` interface and command-line parsing logic. ([b98cbe3](https://github.com/webnaresh/pruny/commit/b98cbe3884c4439df835dc82e04f6a4fc37e0bc2))
* Add debug logging for internal and external export usage in the unused-exports scanner. ([a5484bd](https://github.com/webnaresh/pruny/commit/a5484bd9fd46521fe6002f18235630d174f1a970))
* add function to remove orphaned class-level decorators and improve robustness of method removal by adding a fallback search. ([4dfe3c4](https://github.com/webnaresh/pruny/commit/4dfe3c4bbe40131b1d7a55fc93dcf38e133f3a70))
* add functionality to scan for and delete unused source assets. ([f5f7b8f](https://github.com/webnaresh/pruny/commit/f5f7b8fbb33f6ac689de0b05bb6525e0a2471746))
* Add interactive cleanup selection and Git safety check to the fixer logic. ([6879a9b](https://github.com/webnaresh/pruny/commit/6879a9b3dac185524578e8f39557521daa0cb7f3))
* Add missing asset (broken link) detection, displaying file and line number references for manual remediation. ([3dc253c](https://github.com/webnaresh/pruny/commit/3dc253c18b723f194a9e38bc7ab498c224ba0164))
* Add new action prompt for dry run and deletion, and improve service method lookup by incorporating an approximate line number. ([44399d7](https://github.com/webnaresh/pruny/commit/44399d757ad472e08034063d526d4de62291ebbc))
* add prompts package and its types for interactive user input. ([d0c549c](https://github.com/webnaresh/pruny/commit/d0c549cb33e06f9c02d3071959b818f0014a772c))
* add unused-imports plugin and rule to ESLint configuration ([867728f](https://github.com/webnaresh/pruny/commit/867728ff6c2291d755ac9c5cb0c52a7d34347f87))
* always display missing assets status and provide explicit feedback for zero broken links. ([64e2bdf](https://github.com/webnaresh/pruny/commit/64e2bdfd816171e7c5996ec1e830772fdbdc6897))
* Change cleanup selection from multiselect to single-select with a cancel option. ([cf47674](https://github.com/webnaresh/pruny/commit/cf47674a8d00aa2a4755529ed8ff34b279051858))
* Display 'all good' messages when no unused routes, assets, files, or exports are found and refactor conditional checks for deletion. ([657caec](https://github.com/webnaresh/pruny/commit/657caec135fe0958c0fc16e42c2196f37b406a12))
* Enhance asset usage detection in scanners to include filename and basename matches for improved accuracy. ([f3a8cd2](https://github.com/webnaresh/pruny/commit/f3a8cd2d37a8443d58a19c4d0501d21ff6c79af4))
* enhance declaration handling by exporting `findDeclarationStart` and adding structural cleanup for unmatched braces ([818c556](https://github.com/webnaresh/pruny/commit/818c556f356acf47b79ab87a0973ee8ed2b23dcc))
* Enhance dry-run reporting and service method path resolution, adding debug logs to the service method finder. ([c8e1e5c](https://github.com/webnaresh/pruny/commit/c8e1e5cc763e4a69fddccf433850bd026518a6db))
* enhance method declaration parsing for NestJS methods and refine declaration index lookup in fixer. ([d405ef5](https://github.com/webnaresh/pruny/commit/d405ef5a14d19ffaee22f58b2d5654afc46e5494))
* Enhance monorepo detection to automatically find the root and allow scanning a single app when invoked from within it. ([91ed249](https://github.com/webnaresh/pruny/commit/91ed24923a15987aa1593230f4487832ce8a0e63))
* enhance unused export detection with new regex-based usage checks and update API patterns to support TypeScript generics. ([c0f89e4](https://github.com/webnaresh/pruny/commit/c0f89e42d058f15cd9765ff7cc07aa154f4c5a5b))
* Enhance unused routes and exports display to include the count of affected files. ([da2a377](https://github.com/webnaresh/pruny/commit/da2a377f9d94ae47fa2d9d06d62f00fa3432b1d1))
* enhance unused service detection by recognizing framework-managed and internally called methods. ([5401485](https://github.com/webnaresh/pruny/commit/5401485536b9d60748f850ea7ba17a269ac39602))
* ignore XML, robots, and service worker files during public asset scanning ([a0bcc78](https://github.com/webnaresh/pruny/commit/a0bcc7855a80477706810f7255ab1824d6f6ff55))
* Implement monorepo isolation for unused export scanning and refine external usage detection logic by optimizing fast-path checks and correcting line content analysis. ([2a6b9ac](https://github.com/webnaresh/pruny/commit/2a6b9accf61b5490b3a1c82757c727d78cf34720))
* Implement NestJS global prefix detection, add a dry run option to CLI, and introduce import resolution utilities. ([4a802ef](https://github.com/webnaresh/pruny/commit/4a802ef69c5f9221aa04fa9cdaae445d55211173))
* Improve API endpoint extraction from template literals and normalize paths by handling whitespace and dynamic base URLs. ([c691ccd](https://github.com/webnaresh/pruny/commit/c691ccda472679c36514fb2805feea46a4449e78))
* integrate source asset scanning into the main scanner. ([282497c](https://github.com/webnaresh/pruny/commit/282497c5f6fa0b5e5d2959df8145633db77cfb75))
* introduce `--folder` CLI option for scanning specific sub-directories and enhance fixer safety for method removal. ([2601464](https://github.com/webnaresh/pruny/commit/2601464f5f37d2d51a105c0beb9f53c83697f614))
* Introduce `findMethodLine` to directly locate service methods, refining both `willBeDeleted` prediction and cascading removal logic. ([7d14a2f](https://github.com/webnaresh/pruny/commit/7d14a2fe364d11bb7fbfec41e2602629bcf1c98e))
* introduce `silent` option to `scanUnusedExports` and optimize unused route file processing. ([391aabc](https://github.com/webnaresh/pruny/commit/391aabc1a94d81007fde0cb22e075902e3a72863))
* Introduce consolidated output for multi-app monorepo scans and refine export result counting. ([9003cc2](https://github.com/webnaresh/pruny/commit/9003cc20350e7189af465dc0fcacf91bb1c7a464))
* introduce dry-run mode for file deletions and enhance unused file scanning by including all module files as entry points. ([668b293](https://github.com/webnaresh/pruny/commit/668b2932123105b919bee999795e06a7a0fcd2b6))
* introduce main navigation loop with an explicit exit option for interactive app selection. ([3cc68bf](https://github.com/webnaresh/pruny/commit/3cc68bfdf0c538d0ef02a78d0ee783afa892707b))
* introduce missing assets scanner to detect and report referenced but absent public files ([e800422](https://github.com/webnaresh/pruny/commit/e800422f922048328328442ad43eb8b9a4d9073a))
* loop back to menu after each fix action ([4224438](https://github.com/webnaresh/pruny/commit/4224438c6e6d1bea4bff54abb77849433ecd19ee))
* **nestjs:** add unused service methods scanner and auto-fix ([f121b9d](https://github.com/webnaresh/pruny/commit/f121b9d05864e44a6e6141aa32841061b04345c4))
* Re-enable orphaned decorator cleanup by explicitly ignoring class-level decorators to prevent class header destruction. ([9cf268c](https://github.com/webnaresh/pruny/commit/9cf268c5755320cf2d5043730fb81ff792f0007e))
* Refactor and enhance class method detection in `file-processor.ts` for improved unused export analysis, including a more robust method regex. ([7c05d5b](https://github.com/webnaresh/pruny/commit/7c05d5b67ef41d524afc798cd0c499ab0a3c4458))
* refine route cleaning conditions and use accurate method names for removal with conditional debug logging. ([e612738](https://github.com/webnaresh/pruny/commit/e61273890237d6f5b606df9b3a47c2a136dff3e7))
* remove unused source assets scanning and cleanup functionality ([71fb1f4](https://github.com/webnaresh/pruny/commit/71fb1f4b7e33e8d4d17fda7320cc5f560e77a6fe))
* Scope scanners to the app directory for app-specific scans and update HTTP call unused counts to display as '-'. ([0041af8](https://github.com/webnaresh/pruny/commit/0041af8c09afde8253bd4f822c7cef617329a3fd))
* Support app-specific directories for public asset scans and introduce a custom `console.table` replacement for output. ([c31b2b8](https://github.com/webnaresh/pruny/commit/c31b2b87a34b476e53271f9c6d09f1f6a70b7111))

## [1.28.1](https://github.com/webnaresh/pruny/compare/v1.28.0...v1.28.1) (2026-02-14)


### Bug Fixes

* HTTP usage scanner now respects configured ignore folders, including 'public'. ([177703b](https://github.com/webnaresh/pruny/commit/177703b42d3c073cc0c1aebb887adfe4e8698f1b))

# [1.28.0](https://github.com/webnaresh/pruny/compare/v1.27.0...v1.28.0) (2026-02-14)


### Features

* Adjust HTTP usage scanner to include the public folder and remove default ignore patterns from the configuration. ([d05e398](https://github.com/webnaresh/pruny/commit/d05e398322544db6d93c136de7af9c44c67d1f07))

# [1.27.0](https://github.com/webnaresh/pruny/compare/v1.26.0...v1.27.0) (2026-02-14)


### Features

* Enhance HTTP client detection regex patterns to correctly parse calls with TypeScript type arguments. ([be45828](https://github.com/webnaresh/pruny/commit/be458281e931210be05f090618fddc676287783c))

# [1.26.0](https://github.com/webnaresh/pruny/compare/v1.25.0...v1.26.0) (2026-02-14)


### Bug Fixes

* prevent http-usage scanner from ignoring files based on `config.ignore.files`. ([ee64a28](https://github.com/webnaresh/pruny/commit/ee64a28559eb95fcc72120bb7d0227baf06fa2a9))


### Features

* Add HTTP client usage scanner for Axios, Fetch, Got, and Ky, and display their counts in the scan results. ([a1876ea](https://github.com/webnaresh/pruny/commit/a1876ea8a88734d16771949477ee47596d3a1069))

# [1.25.0](https://github.com/webnaresh/pruny/compare/v1.24.0...v1.25.0) (2026-02-14)


### Features

* Implement `--ignore-apps` CLI option to exclude specified monorepo applications from scanning and refactor `PrunyOptions` and `PrunyConfig` type definitions. ([7841f01](https://github.com/webnaresh/pruny/commit/7841f0167b6f3540f12a1111454581fef4cccea5))

# [1.24.0](https://github.com/webnaresh/pruny/compare/v1.23.0...v1.24.0) (2026-02-14)


### Features

* Add monorepo support by detecting applications and performing per-app scanning and fixing with dynamic configuration. ([9f74e61](https://github.com/webnaresh/pruny/commit/9f74e6137e4a36af51501e230f9e63015cb7b871))

# [1.23.0](https://github.com/webnaresh/pruny/compare/v1.22.0...v1.23.0) (2026-02-14)


### Features

* Introduce app-specific scanning to narrow route discovery to a single application directory while continuing project-wide reference analysis. ([0ce6453](https://github.com/webnaresh/pruny/commit/0ce6453babc5ec657496dad2825f15d40bdb96cd))

# [1.22.0](https://github.com/webnaresh/pruny/compare/v1.21.1...v1.22.0) (2026-02-13)


### Features

* improve method definition detection by adding regex and name-based checks. ([b2e15d8](https://github.com/webnaresh/pruny/commit/b2e15d872e3915b61b15ee15b129f5efe056c01b))

## [1.21.1](https://github.com/webnaresh/pruny/compare/v1.21.0...v1.21.1) (2026-02-13)


### Bug Fixes

* Improve declaration index finding by converting HTTP verbs to NestJS decorator format for accurate matching. ([903b382](https://github.com/webnaresh/pruny/commit/903b3822acd81b3590f28dfa924fe36302b81678))

# [1.21.0](https://github.com/webnaresh/pruny/compare/v1.20.0...v1.21.0) (2026-02-13)


### Features

* Improve unused export deletion and export keyword removal by enhancing declaration finding and deletion logic. ([5e6f4b6](https://github.com/webnaresh/pruny/commit/5e6f4b65e714f7c21ba4c6754fef40e998565bd7))

# [1.20.0](https://github.com/webnaresh/pruny/compare/v1.19.0...v1.20.0) (2026-02-13)


### Features

* Enhance unused export scanning to detect NestJS service methods and refine ignored HTTP method exports. ([35c5a8f](https://github.com/webnaresh/pruny/commit/35c5a8fdd87f6bdc4c37072e2637b95737f73e12))

# [1.19.0](https://github.com/webnaresh/pruny/compare/v1.18.0...v1.19.0) (2026-02-13)


### Features

* enhance API route matching by supporting template literals in patterns and improving NestJS path variation detection. ([020143f](https://github.com/webnaresh/pruny/commit/020143f127546b5e6828dde065196e2c6827236f))

# [1.18.0](https://github.com/webnaresh/pruny/compare/v1.17.1...v1.18.0) (2026-02-13)


### Features

* Enhance ignore pattern matching in `shouldIgnore`, apply route ignores to both API and file paths, and remove automatic `**` prefixing for route ignore patterns. ([cd21adf](https://github.com/webnaresh/pruny/commit/cd21adf2a0a16c52a3a7fac146b3f1668acbfb64))
* Enhance unused route deletion by grouping routes by file and selectively pruning methods from internally used NestJS files. ([6a23640](https://github.com/webnaresh/pruny/commit/6a23640535d2839b1cc4c7cb36c3a3a3ad3b1180))

## [1.17.1](https://github.com/webnaresh/pruny/compare/v1.17.0...v1.17.1) (2026-02-13)


### Bug Fixes

* Prevent deletion of internally used NestJS files and improve glob pattern matching for ignore configurations. ([ec1bdc6](https://github.com/webnaresh/pruny/commit/ec1bdc6fe6a0cb70f67bdc834696d551de4b5f87))

# [1.17.0](https://github.com/webnaresh/pruny/compare/v1.16.0...v1.17.0) (2026-02-13)


### Features

* Enhance API endpoint detection by refining regex patterns to capture full paths and adding generic path matching, and consolidate test file entry point glob patterns. ([682e920](https://github.com/webnaresh/pruny/commit/682e92076308af0e36e89bdc0e175cc814cd4853))

# [1.16.0](https://github.com/webnaresh/pruny/compare/v1.15.1...v1.16.0) (2026-02-13)


### Features

* Implement framework-specific unused route deletion, add NestJS path normalization, expand ignored file patterns, and improve file operation robustness. ([adec359](https://github.com/webnaresh/pruny/commit/adec359e4d61a1c295d1ea2386f2acd8d00107d3))

## [1.15.1](https://github.com/webnaresh/pruny/compare/v1.15.0...v1.15.1) (2026-02-13)


### Bug Fixes

* ensure Summary Report reflects post-fix state and implement unused source file deletion ([e2ead6b](https://github.com/webnaresh/pruny/commit/e2ead6b9cc8275736ee072bff2322181ad8f7ada))

# [1.15.0](https://github.com/webnaresh/pruny/compare/v1.14.0...v1.15.0) (2026-02-13)


### Features

* implement surgical removal of unused API methods with --fix ([eb7373e](https://github.com/webnaresh/pruny/commit/eb7373ea78d53129400bf224fbca90c58fafd4d6))

# [1.14.0](https://github.com/webnaresh/pruny/compare/v1.13.0...v1.14.0) (2026-02-13)


### Features

* remove used routes references from output ([bdf0991](https://github.com/webnaresh/pruny/commit/bdf09912b6ed75b7dc3a6ffdfd7e7f68df47f702))
* reorder CLI output to keep Summary Table at the bottom ([0a99f18](https://github.com/webnaresh/pruny/commit/0a99f187d76dbf8141967d94830dbe7471f49107))

# [1.13.0](https://github.com/webnaresh/pruny/compare/v1.12.0...v1.13.0) (2026-02-13)


### Features

* ignore service worker files as entry points in monorepos ([2b199c5](https://github.com/webnaresh/pruny/commit/2b199c586719025471055f0c535713143af5717b))

# [1.12.0](https://github.com/webnaresh/pruny/compare/v1.11.0...v1.12.0) (2026-02-13)


### Features

* ignore config files and Next.js metadata as entry points ([c7034ec](https://github.com/webnaresh/pruny/commit/c7034ec3f5e48593255e77076e90c54def6a841b))

# [1.11.0](https://github.com/webnaresh/pruny/compare/v1.10.1...v1.11.0) (2026-02-13)


### Features

* Expand ignored files list in unused file scanner to include more Next.js specific and generic configuration files. ([c5aba4e](https://github.com/webnaresh/pruny/commit/c5aba4e0ecf3c2566d761f909afcb5268bc0b7ec))

## [1.10.1](https://github.com/webnaresh/pruny/compare/v1.10.0...v1.10.1) (2026-02-13)


### Bug Fixes

* Improve unused export and file detection by ignoring comments, template literals, and string literals, and enhancing code pattern matching to include TypeScript generics. ([4fdee50](https://github.com/webnaresh/pruny/commit/4fdee506b401511062f6bf32be5951b135948223))

# [1.10.0](https://github.com/webnaresh/pruny/compare/v1.9.2...v1.10.0) (2026-02-13)


### Features

* add worker thread parallelization for 22x faster scans on large codebases ([0ce6489](https://github.com/webnaresh/pruny/commit/0ce6489f6f9e4c4d5e948ae03ce89d8a27cbba9c))

## [1.9.2](https://github.com/webnaresh/pruny/compare/v1.9.1...v1.9.2) (2026-02-13)


### Bug Fixes

* add template literal tracking to prevent false positives in multi-line backtick strings ([630221b](https://github.com/webnaresh/pruny/commit/630221b03d89d25952fd73c2e950f06a1ba74363))

## [1.9.1](https://github.com/webnaresh/pruny/compare/v1.9.0...v1.9.1) (2026-02-13)


### Bug Fixes

* use glob patterns (**/proxy.*, **/middleware.*) for proper ignore matching and add proxy to entry patterns ([aa00709](https://github.com/webnaresh/pruny/commit/aa007090a511d7eabef76483612ac64e46cadbfe))

# [1.9.0](https://github.com/webnaresh/pruny/compare/v1.8.0...v1.9.0) (2026-02-13)


### Features

* show current filename in progress output and use glob patterns for ignore ([a21d1f2](https://github.com/webnaresh/pruny/commit/a21d1f2fecc2ec64fa3b73579cadf452ab830936))

# [1.8.0](https://github.com/webnaresh/pruny/compare/v1.7.1...v1.8.0) (2026-02-13)


### Features

* add progress indicators and expand build directory ignore patterns ([388dbc5](https://github.com/webnaresh/pruny/commit/388dbc54aded9a1627e1cb59da5246ce328ec5bd))

## [1.7.1](https://github.com/webnaresh/pruny/compare/v1.7.0...v1.7.1) (2026-02-13)


### Performance Improvements

* fix catastrophic backtracking in string literal stripping regex ([ea8b924](https://github.com/webnaresh/pruny/commit/ea8b9240b1f6ed4246a7132576e6946f1f84707e))

# [1.7.0](https://github.com/webnaresh/pruny/compare/v1.6.0...v1.7.0) (2026-02-13)


### Features

* improve filter to prioritize exact path segment matches and update help text ([c708b55](https://github.com/webnaresh/pruny/commit/c708b55ecfde2a307b74f6b50bda0ebcd9a509f5))

# [1.6.0](https://github.com/webnaresh/pruny/compare/v1.5.0...v1.6.0) (2026-02-13)


### Bug Fixes

* process multiple exports in same file in single run by sorting in reverse line order ([d209451](https://github.com/webnaresh/pruny/commit/d20945185066c395a64ea9d034fce7dc23da4266))


### Features

* improve export usage detection to ignore string literals and require code context ([cf559d3](https://github.com/webnaresh/pruny/commit/cf559d3035a83259787c3a1020e4c737f6e12116))

# [1.5.0](https://github.com/webnaresh/pruny/compare/v1.4.0...v1.5.0) (2026-02-13)


### Features

* delete entire unused declarations instead of just removing export keyword ([2edb1b9](https://github.com/webnaresh/pruny/commit/2edb1b93c949168cf0225f979a1ed00e1d2fd26c))

# [1.4.0](https://github.com/webnaresh/pruny/compare/v1.3.0...v1.4.0) (2026-02-13)


### Features

* add execution time display ([773cab0](https://github.com/webnaresh/pruny/commit/773cab06a39a0cd1e59f737507ab1fc8d48bc3ff))

# [1.3.0](https://github.com/webnaresh/pruny/compare/v1.2.14...v1.3.0) (2026-02-13)


### Bug Fixes

* remove registry-url from setup-node for semantic-release compatibility ([e96c04a](https://github.com/webnaresh/pruny/commit/e96c04a2b4f50fb49281025a4578e8f618b9c782))


### Features

* add semantic versioning with automated changelog generation ([bda0f61](https://github.com/webnaresh/pruny/commit/bda0f613be3c8fd94cb916d2c5258ef9e2c53b94))
* integrate semantic-release for automated versioning, changelog generation, and GitHub releases. ([ab397a6](https://github.com/webnaresh/pruny/commit/ab397a670de7d9dd3e80b05c5892e1eb3af80e5f))

# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).
