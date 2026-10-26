'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadYco } = require('./helpers');

const { createTranslationService } = loadYco();

/**
 * 本物の Translator / LanguageDetector の代わりになる偽物。
 * `options` で、利用可否や失敗のさせ方を変えられる。
 */
function createFakeEnv(options = {}) {
  const {
    availability = 'available',
    createError = null,
    downloadProgress = [],
    detect = () => 'en',
    withDetector = true,
    withTranslator = true,
  } = options;

  const calls = { create: 0, translate: [] };
  const env = {};

  if (withTranslator) {
    env.Translator = {
      availability: async (languagePair) => (typeof availability === 'function' ? availability(languagePair) : availability),
      create: async (createOptions) => {
        calls.create += 1;
        if (createError) throw createError;
        const monitor = new EventTarget();
        createOptions.monitor?.(monitor);
        for (const loaded of downloadProgress) {
          monitor.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }));
        }
        return {
          translate: async (text) => {
            calls.translate.push(text);
            return `訳:${text}`;
          },
        };
      },
    };
  }
  if (withDetector) {
    env.LanguageDetector = {
      create: async () => ({
        detect: async (text) => [{ detectedLanguage: detect(text), confidence: 0.9 }],
      }),
    };
  }
  return { env, calls };
}

/** 状態メッセージを記録しながら、サービスを作る */
function createService(envOptions, serviceOptions = {}) {
  const { env, calls } = createFakeEnv(envOptions);
  const statuses = [];
  const service = createTranslationService({
    t: (key) => key, // メッセージのキーをそのまま返す
    onStatus: (message) => statuses.push(message),
    env,
    ...serviceOptions,
  });
  return { service, statuses, calls };
}

// 失敗の詳細は console.warn に出る。テストの出力を汚さないよう黙らせる
test.before(() => test.mock.method(console, 'warn', () => {}));

test('翻訳できたら訳文を返し、状態表示を消す', async () => {
  const { service, statuses, calls } = createService();
  assert.equal(await service.translate('Hello there.'), '訳:Hello there.');
  assert.deepEqual(calls.translate, ['Hello there.']);
  assert.equal(statuses.at(-1), '');
});

test('同じ文はキャッシュから返し、翻訳器を呼び直さない', async () => {
  const { service, calls } = createService();
  await service.translate('Hello there.');
  await service.translate('Hello there.');
  assert.equal(calls.translate.length, 1);
});

test('翻訳器は原語ごとに 1 度だけ作る', async () => {
  const { service, calls } = createService();
  await Promise.all([service.translate('One.'), service.translate('Two.'), service.translate('Three.')]);
  assert.equal(calls.create, 1);
});

test('複数行の字幕は、行ごとに訳して改行でつなぐ', async () => {
  const { service, calls } = createService();
  assert.equal(await service.translate('First.\nSecond.'), '訳:First.\n訳:Second.');
  assert.deepEqual(calls.translate, ['First.', 'Second.']);
});

test('すでに日本語なら、訳さずに空文字を返す', async () => {
  const { service, calls } = createService();
  assert.equal(await service.translate('こんにちは、世界。'), '');
  assert.equal(calls.translate.length, 0);
});

// ---- 使えない理由の通知 ----------------------------------------------------

test('Translator API がなければ、理由を通知して null を返す', async () => {
  const { service, statuses } = createService({ withTranslator: false });
  assert.equal(await service.translate('Hello there.'), null);
  assert.ok(statuses.includes('statusNoApi'));
});

test('翻訳モデルが利用できなければ、言語の組を添えて通知する', async () => {
  const { service, statuses } = createService({ availability: 'unavailable' });
  assert.equal(await service.translate('Hello there.'), null);
  assert.ok(statuses.includes('statusUnavailable (en→ja)'));
});

test('翻訳器の作成が例外になったら、エラー名とメッセージを通知する', async () => {
  const error = Object.assign(new Error('The model is broken'), { name: 'InvalidStateError' });
  const { service, statuses } = createService({ availability: 'downloadable', createError: error });
  assert.equal(await service.translate('Hello there.'), null);
  assert.ok(statuses.includes('statusErrorInvalidStateError: The model is broken'));
});

test('モデルのダウンロード中は、進捗(%)を通知する', async () => {
  const { service, statuses } = createService({ availability: 'downloadable', downloadProgress: [0.25, 0.7] });
  await service.translate('Hello there.');
  assert.ok(statuses.includes('statusDownloading'));
  assert.ok(statuses.includes('statusDownloading 25%'));
  assert.ok(statuses.includes('statusDownloading 70%'));
});

test('言語を判定できず ASCII でもなければ、理由を通知する', async () => {
  const { service, statuses } = createService({ withDetector: false });
  assert.equal(await service.translate('Bonjour à tous mes amis'), null);
  assert.ok(statuses.includes('statusNoLang'));
});

test('判定器がなくても、ASCII だけの字幕は英語として訳す', async () => {
  const { service } = createService({ withDetector: false });
  assert.equal(await service.translate('Hello there.'), '訳:Hello there.');
});

// ---- 失敗からの回復 -----------------------------------------------------------

test('一度訳せたら、以後の一時的な失敗は通知しない', async () => {
  const { service, statuses } = createService({
    detect: (text) => (text.includes('Bonjour') ? 'fr' : 'en'),
    // 英語→日本語は使えるが、フランス語→日本語は使えない
    availability: ({ sourceLanguage }) => (sourceLanguage === 'fr' ? 'unavailable' : 'available'),
  });

  assert.equal(await service.translate('Hello there.'), '訳:Hello there.');
  assert.equal(await service.translate('Bonjour à tous mes amis.'), null);
  assert.ok(!statuses.some((s) => s.startsWith('statusUnavailable')), `通知されていない: ${statuses}`);
});

test('まだ一度も訳せていないうちは、失敗を通知する', async () => {
  const { service, statuses } = createService({
    detect: () => 'fr',
    availability: ({ sourceLanguage }) => (sourceLanguage === 'fr' ? 'unavailable' : 'available'),
  });
  assert.equal(await service.translate('Bonjour à tous mes amis.'), null);
  assert.ok(statuses.includes('statusUnavailable (fr→ja)'));
});

test('失敗後は、一定時間は再試行せず、過ぎたら再試行する', async () => {
  let time = 0;
  let availability = 'unavailable';
  const { service, statuses, calls } = createService(
    { availability: () => availability },
    { now: () => time, retryMs: 15000 },
  );

  assert.equal(await service.translate('First sentence.'), null);
  availability = 'available';
  time = 5000; // まだ再試行しない
  assert.equal(await service.translate('Second sentence.'), null);
  assert.equal(calls.create, 0);

  time = 20000; // 再試行する
  assert.equal(await service.translate('Third sentence.'), '訳:Third sentence.');
  assert.ok(statuses.includes('statusUnavailable (en→ja)'));
});

test('retry(): 失敗の記録を捨てて、すぐにやり直せる', async () => {
  let availability = 'unavailable';
  const { service, statuses } = createService({ availability: () => availability }, { now: () => 0 });

  assert.equal(await service.translate('First sentence.'), null);
  availability = 'available';
  service.retry();
  assert.equal(statuses.at(-1), 'statusPreparing');
  assert.equal(await service.translate('Second sentence.'), '訳:Second sentence.');
  assert.equal(statuses.at(-1), '');
});

test('begin(): 「準備中」を通知する', () => {
  const { service, statuses } = createService();
  service.begin();
  assert.deepEqual(statuses, ['statusPreparing']);
});

test('prewarm(): 準備できたら、状態表示を消す', async () => {
  const { service, statuses } = createService();
  service.begin();
  await service.prewarm('en');
  assert.equal(statuses.at(-1), '');
});

test('翻訳器の呼び出しが例外を投げても、translate() は null を返す', async () => {
  const { env } = createFakeEnv();
  env.Translator.create = async () => ({
    translate: async () => {
      throw new Error('boom');
    },
  });
  const statuses = [];
  const service = createTranslationService({ t: (key) => key, onStatus: (m) => statuses.push(m), env });
  assert.equal(await service.translate('Hello there.'), null);
  assert.ok(statuses.some((s) => s.startsWith('statusError')));
});

// ---- 応答しない翻訳 API ----------------------------------------------------------

const never = () => new Promise(() => {});
const fastTimeouts = { availabilityMs: 20, createMs: 20, translateMs: 20 };

test('availability が応答しなくても、タイムアウトして null を返し、理由を通知する', async () => {
  const { service, statuses } = createService({ availability: never }, { timeouts: fastTimeouts });
  assert.equal(await service.translate('Hello there.'), null);
  assert.ok(statuses.some((s) => s.startsWith('statusErrorTimeoutError')), `通知された: ${statuses}`);
});

test('タイムアウトの後も、回復したら訳せる(翻訳の列が詰まらない)', async () => {
  let hang = true;
  const { service } = createService(
    { availability: () => (hang ? never() : 'available') },
    { timeouts: fastTimeouts, now: () => 0 },
  );
  assert.equal(await service.translate('First sentence.'), null);
  hang = false;
  service.retry(); // 失敗の記録を捨ててやり直す
  assert.equal(await service.translate('Second sentence.'), '訳:Second sentence.');
});

test('翻訳器の translate が応答しなければ、その翻訳器を捨てて作り直す', async () => {
  const { env, calls } = createFakeEnv();
  let hang = true;
  env.Translator.create = async () => {
    calls.create += 1;
    return { translate: async (text) => (hang ? never() : `訳:${text}`) };
  };
  const service = createTranslationService({ t: (key) => key, onStatus: () => {}, env, timeouts: fastTimeouts });

  assert.equal(await service.translate('First sentence.'), null);
  hang = false;
  assert.equal(await service.translate('Second sentence.'), '訳:Second sentence.');
  assert.equal(calls.create, 2, '壊れた翻訳器を使い回さず、作り直した');
});

// ---- 言語判定のリセット ----------------------------------------------------------------

test('resetLanguage(): 前の動画の言語を引きずらない', async () => {
  const askedLanguages = [];
  const { service } = createService({
    detect: (text) => (text.startsWith('Bonjour') ? 'fr' : 'en'),
    availability: ({ sourceLanguage }) => {
      askedLanguages.push(sourceLanguage);
      return 'available';
    },
  });

  await service.translate('Bonjour à tous mes amis.'); // fr と判定される
  await service.translate('Yes.'); // 短い文は、直前の言語(fr)を使ってしまう
  assert.deepEqual(askedLanguages, ['fr'], '短い文は fr として訳そうとする(リセットしない場合)');

  service.resetLanguage(); // 動画が替わった
  await service.translate('No.'); // 直前の言語がないので、ASCII は英語として扱う
  assert.deepEqual(askedLanguages, ['fr', 'en']);
});

// ---- ユーザー操作が要るモデルの取得 --------------------------------------------------

test('NotAllowedError は専用のメッセージで通知し、次に開くときの prewarm 対象に加える', async () => {
  const gestureError = Object.assign(new Error('Requires a user gesture'), { name: 'NotAllowedError' });
  const created = [];
  const { env } = createFakeEnv({ detect: () => 'fr', availability: 'downloadable' });
  let allowed = false;
  env.Translator.create = async ({ sourceLanguage }) => {
    created.push(sourceLanguage);
    if (!allowed) throw gestureError;
    return { translate: async (text) => `訳:${text}` };
  };
  const statuses = [];
  const service = createTranslationService({ t: (key) => key, onStatus: (m) => statuses.push(m), env, now: () => 0 });

  assert.equal(await service.translate('Bonjour à tous mes amis.'), null);
  assert.ok(statuses.includes('statusNeedsGesture (fr)'), `通知された: ${statuses}`);

  allowed = true; // 次に、小窓を開くクリックの直後に prewarmAll() を呼ぶ
  created.length = 0;
  service.retry();
  await service.prewarmAll();
  assert.ok(created.includes('en') && created.includes('fr'), `英語とフランス語を用意した: ${created}`);
  assert.equal(await service.translate('Bonjour à tous mes amis.'), '訳:Bonjour à tous mes amis.');
});

// ---- 翻訳先の変更 ----------------------------------------------------------------

test('setTargetLang(): 新しい翻訳先で翻訳器を作り直し、キャッシュも前の言語のものを使わない', async () => {
  const pairs = [];
  const { service, calls } = createService(
    { availability: (pair) => (pairs.push(`${pair.sourceLanguage}>${pair.targetLanguage}`), 'available') },
    { targetLang: 'ja' },
  );

  assert.equal(await service.translate('Hello there, world'), '訳:Hello there, world');
  assert.equal(service.setTargetLang('ja'), false, '同じ言語なら何も変わらない');
  assert.equal(service.setTargetLang('ko'), true);
  assert.equal(await service.translate('Hello there, world'), '訳:Hello there, world');

  assert.deepEqual(pairs, ['en>ja', 'en>ko']);
  assert.equal(calls.create, 2, '言語が変わったので作り直す');
  assert.equal(calls.translate.length, 2, 'キャッシュの訳を使い回さない');
});

test('setTargetLang(): 翻訳中に翻訳先が変わったら、古い言語の訳を返さずキャッシュにも入れない', async () => {
  const { env, calls } = createFakeEnv();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const originalCreate = env.Translator.create;
  env.Translator.create = async (options) => {
    if (options.targetLanguage === 'ja') await gate; // 古い言語の翻訳器は、遅れて出来上がる
    return originalCreate(options);
  };
  const service = createTranslationService({ env, t: (key) => key, onStatus() {}, targetLang: 'ja' });

  const stale = service.translate('Hello there, world');
  await new Promise((resolve) => setTimeout(resolve, 0));
  service.setTargetLang('ko');
  release();
  assert.equal(await stale, null, '古い言語の訳は捨てる');
  assert.equal(await service.translate('Hello there, world'), '訳:Hello there, world');
  assert.equal(calls.create, 2);
});

test('翻訳先が原語と同じなら、訳さない(空文字)', async () => {
  const { service } = createService({}, { targetLang: 'en' });
  assert.equal(await service.translate('Hello there, world'), '');
});
