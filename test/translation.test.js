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
  const error = Object.assign(new Error('Requires a user gesture'), { name: 'NotAllowedError' });
  const { service, statuses } = createService({ availability: 'downloadable', createError: error });
  assert.equal(await service.translate('Hello there.'), null);
  assert.ok(statuses.includes('statusErrorNotAllowedError: Requires a user gesture'));
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
