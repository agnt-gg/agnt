# trust system Implementation Baseline — 2026-07-07

All numbers measured from the live tree. NOTHING guessed.

## File hashes (pre-implementation)

| File | Lines | Bytes | SHA-256 |
|---|---:|---:|---|
| backend/src/plugins/PluginInstaller.js | 1364 | 54862 | c0e7d50952dde5c77abdc8214942a0c00ba61395adf66865eed721a8e35a1ba6 |
| backend/src/plugins/PluginManager.js | 748 | 29321 | 99178838586111431a6f92b377b86e9f13eebfd40861dac937fcd66f5208d349 |
| backend/src/routes/PluginRoutes.js | 1103 | 38023 | 2276bac4d27a77922ec08d02db8b185b883d90899828293010935a61a585f9b4 |
| backend/plugins/build-plugin.js | 353 | 12982 | 3b8c62f8d5bbfc82bacec851864f45bd8e659f0d253f433215e5b1d4178f7547 |
| backend/plugins/build-all-plugins.js | 100 | 2974 | 2a27362f78ed14a2dc34b9c840100b6dd80f75dda595eb5a394b257dd722d2df |
| backend/plugins/marketplace.json | 1276 | 44432 | 6df35a9e67233bd7119d40cafd24ccf0b5566d519c4a80b31c787db34a622f63 |

## Fleet

- marketplace.json records: 39
- marketplace-default .agnt artifacts: 39
- dev plugin dirs: 39 (38 real + _TEMPLATE)

## .agnt artifact hashes (SRI sha256, pre-stamp)

| Artifact | Bytes | integrity |
|---|---:|---|
| atlas-cloud.agnt | 7526 | sha256-FkXgevF+ZYln4tnMWzFLft+gLd6353jnCu2wWmHAtk8= |
| bankr-plugin.agnt | 10122 | sha256-sUwpoXPaVk2EDW4W2xcWP5eynN+Qv5Kxrn0S9YGapCY= |
| bitcoin-price-checker.agnt | 1224 | sha256-k7tT6087yvpFX/PTqjgtOR2UxkMFgGsQr39IVrCDvf0= |
| calculator-plugin.agnt | 1803 | sha256-Wtm6h+JM65XYEN/kBQOk4DAXO+8YyyltiCJb9a93uUc= |
| calendly-plugin.agnt | 945033 | sha256-ZPLF585UKrrG8LcpFMraxRy1cfyLFIRJ5VMUnMdZQ3o= |
| chucknorris-joke-plugin.agnt | 1661076 | sha256-mDSPNrr6x+NFyP2Yz1EJF765E0UXJv6SEgUUjQkSKxc= |
| claude-agent-plugin.agnt | 35548322 | sha256-UVVMDqCDLgRQidC9o2Dl8jhFRi6F6bqmYwoWx6TUVxA= |
| cua-toolkit.agnt | 13179 | sha256-xXfY8/GDkXWk4QuFASGoiPQZ0/YshWAErxQqjBUcZww= |
| dice-roller-plugin.agnt | 1816 | sha256-32GHstW/mv629AttvXxqq9hJBAzyTHq9HsXTgggxRN4= |
| discord-plugin.agnt | 3238038 | sha256-bQu+J9pVET4nSiLnfwlkHdAN2WnTM5rzxI6tPUgBhTo= |
| dropbox-plugin.agnt | 779153 | sha256-OCJtajWSpt6imDUGPsB6hh66grz2IORNR/E4sqfOWuw= |
| elevenlabs-plugin.agnt | 804475 | sha256-CjuBtVtNccbhczQ/2kYoseATDxVPLuOBTVLK89a70ts= |
| ethereum-price-checker.agnt | 748994 | sha256-aovXyIXVtr9Xv/mDb7TAy1O4rJ7icFTxIkjgJGcVkSU= |
| facebook-api-plugin.agnt | 1662103 | sha256-j7ksIwxVFDUGoPXFuIQ+lCMwsgBIsFeYKR0xC2L2Smo= |
| fetch-tool-plugin.agnt | 1661135 | sha256-oyNc2KE4bm7rerbLdHpksmatooVZQ0hI5h/lgv3zxGE= |
| fibonacci-sequence-plugin.agnt | 2513 | sha256-/XM0o7MghC+KSWjbxgTFoFdhCbKGSWdKxl32tgptbHI= |
| firecrawl-plugin.agnt | 777619 | sha256-HtevhlRXFXmuM+UWE39HMvlHekCYohVvUdPxs32JnsA= |
| fs-watcher-plugin.agnt | 104638 | sha256-BAx9rWIZ/uESI7vVWW9XIvvyqKp83Jd/7zVax+geeQk= |
| github-plugin.agnt | 10299 | sha256-6vRiIk7N+urIjP+sxbFL8ovtsvoXZTA/Csr9g0fnR1g= |
| gmail-plugin.agnt | 12517905 | sha256-MFO/lMmMOEFSl3T8e6rHTByAIo4kXyctyGaJZIGShfo= |
| google-drive-plugin.agnt | 12517958 | sha256-vI62Yq/BixanYWNXNMM4g+w+hFjU2YbN9xQ24CiX6/o= |
| google-sheets-plugin.agnt | 12954229 | sha256-y3HtK3A2LFiuf12Rm6mOZ2C7LFmYwoPyAb4zbvUkXR4= |
| google-slides-plugin.agnt | 12519424 | sha256-dCJyMJ1D/0OwONKe4oefgMTx2DRUzg8CBA5+YLPS8RA= |
| list-files-plugin.agnt | 1591 | sha256-aNmj45qqJtprC5PwY4pKup5E+zpX3QgLcsBcrZKq1gI= |
| notion-plugin.agnt | 846028 | sha256-d+nn4SXX6zr+SXqj5t30rMACck6H063+BXMI7gQ5+jQ= |
| obsidian-plugin.agnt | 6831 | sha256-nx6NmSa9hgblVRQLun5Pqp0TmZ2vUdXngSR2hUNndJw= |
| openweathermap-api-plugin.agnt | 4011 | sha256-FlHjBvhUNroPGy2bLCOE7V72Z5rR7DfAt/nIBoMvlFg= |
| random-dice-roller.agnt | 1339 | sha256-u610RmYi7jDpfb4QDcLBvgp3DlBqE8fGxLjBvSmkf18= |
| remotion-plugin.agnt | 7290 | sha256-wqZYEOA1WcEpAVGu+Of2RUWd/+iMRLiS3QBBTsH6A1Q= |
| seedance-plugin.agnt | 810308 | sha256-QLYCbz6TtG/UokqjKLlME6pTEuf7GqBvjD4J8oEuIjg= |
| sentinel.agnt | 41951 | sha256-SDhx5DBodu44R2nf3N6qqucfuYH7pOWyQh24/yezlzk= |
| slack-plugin.agnt | 3411406 | sha256-0Bkn/SCwE+zQxZFmFYljKR9gsseDvooYI6hgsERpW1c= |
| stripe-plugin.agnt | 1309148 | sha256-FcPE0/xakDloKFo9BdlZHMRXLrta3hnUr2JU8hEWJA0= |
| telegram-toolkit.agnt | 13979 | sha256-zHKwjXzrOj4SrHujwyYjskyrlo2BoS6w2ENxhpq6XJw= |
| twitter-plugin.agnt | 225110 | sha256-3dUrxLteTYfu2//GWhKfg8htxAN+v+3KYdzcu556y3w= |
| unsplash-plugin.agnt | 780326 | sha256-kFaJNo3aUDZtAvul9guomwtPktF+JfZA7oa67GdDET8= |
| unturf-ai-plugin.agnt | 749666 | sha256-konjHkgh+kqJ0neaxOhM4WFE2zXQNxt77xYzjPLG++8= |
| youtube-plugin.agnt | 12530388 | sha256-u9rnOVjIss6GNBP5ZZ9BXj8y89KeKkAkoCMMa2o6uPI= |
| zapier-plugin.agnt | 749990 | sha256-SLosCpzdYogLR5n/d0mum9/n7liP8pYRtpQdYtCpyiE= |

## Runtime registry fixture

(Removed — the captured snapshot referenced the developer's real installed-plugin registry. Compat testing now uses synthetic sandboxed registries built by the test suites themselves.)
