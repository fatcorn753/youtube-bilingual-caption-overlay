/**
 * 字幕の履歴を「1 行 = 1 文」に区切る状態機械。ブラウザに依存しない。
 *
 * 入力: 「いま画面に表示されている字幕」(YouTube の字幕は刻々と変わる)
 * 出力: 文が確定するたびに `onCommit(line)` を呼ぶ
 *
 * 表示中の字幕は、次の 3 通りのどれかで変わる。
 *   1. 伸びる        "Hello"  → "Hello there"           (単語が増える)
 *   2. 繰り上がる    "A B C D" → "C D E"                (先頭が消えて、前の末尾が先頭に残る)
 *   3. 入れ替わる    "Hello there" → "Something else"    (新しい発話)
 *
 * まだ文として確定していない字幕を「未確定(pending)」と呼ぶ。次の 2 つでできている。
 *   - carry     : 画面から消えたが、まだ文の終わりに達していない断片
 *   - 表示中の字幕のうち、まだ確定していない後半(先頭から committedLength 文字目以降)
 *
 * 未確定の字幕は、次のどれかで 1 行として確定する。
 *   - 文末記号(. ? ! 。など)が来た                       → その文までを確定
 *   - 話が止まった(句読点なしの自動字幕では短く待つ)    → `commitPending()` を呼ぶ側が判断
 *   - 文末が来ないまま長くなりすぎた                      → 途中でも区切る
 *
 * 単体テストは test/caption-history.test.js。
 */
(function (root) {
  'use strict';

  const YCO = (root.YCO = root.YCO || {});
  const { constants, text: T } = YCO;

  class CaptionHistory {
    #onCommit;
    #limits;
    #timing;

    /** 現在表示中の字幕(消えかけで一時的に短くなっても、長い方を保持する) */
    #visible = '';
    /** #visible の先頭から、確定済み(または carry へ移した)文字数 */
    #committedLength = 0;
    #carry = '';
    /** 文末記号がないまま長く続いた。次に文末記号が来るまで、句読点なしとして扱う */
    #unpunctuatedSticky = false;
    /** 自動生成字幕(ロールアップ表示)か。自動生成字幕は句読点を持たない */
    #rollup = false;
    #lastLine = '';

    /**
     * @param {object} options
     * @param {(line: string) => void} options.onCommit 1 文が確定するたびに呼ばれる
     * @param {object} [options.limits] constants.LIMITS の上書き
     * @param {object} [options.timing] constants.TIMING の上書き
     */
    constructor({ onCommit, limits = constants.LIMITS, timing = constants.TIMING }) {
      this.#onCommit = onCommit;
      this.#limits = limits;
      this.#timing = timing;
    }

    /** 現在表示中の字幕 */
    get visible() {
      return this.#visible;
    }

    /** まだ確定していない字幕(画面に出す「いまの 1 行」) */
    get pending() {
      return T.joinText(this.#carry, this.#visible.slice(this.#committedLength).trim());
    }

    /** 句読点のない字幕として扱っているか */
    get isUnpunctuated() {
      return this.#rollup || this.#unpunctuatedSticky;
    }

    /** 話が止まってから未確定の字幕を確定するまでの待ち時間(ミリ秒) */
    get stallDelayMs() {
      return this.isUnpunctuated ? this.#timing.stallMs : this.#timing.longStallMs;
    }

    /**
     * 表示中の字幕が変わったことを知らせる。
     * @param {string} text 表示中の字幕(何も出ていなければ空文字)
     * @param {{rollup?: boolean}} [options] rollup: 自動生成字幕(ロールアップ表示)か
     */
    update(text, { rollup = this.#rollup } = {}) {
      if (text) this.#rollup = rollup;
      const previous = this.#visible;

      if (!text) {
        // 字幕が消えた
        this.#moveToCarry(previous, previous.length);
        this.#visible = '';
        this.#committedLength = 0;
      } else if (!previous || text.startsWith(previous)) {
        // 伸びた(または最初の字幕)
        if (!previous) this.#committedLength = 0;
        this.#visible = text;
      } else if (previous.startsWith(text)) {
        // 一時的に短くなっただけ。長い方を保持する
      } else {
        this.#replaceVisible(previous, text);
      }

      this.#extractSentences();
    }

    /** 未確定の字幕を、そのまま 1 行として確定する(話が止まったときなど) */
    commitPending() {
      this.#emit(this.pending);
      this.#carry = '';
      this.#committedLength = this.#visible.length;
    }

    /** すべて忘れる(動画が替わったときなど) */
    reset() {
      this.#visible = '';
      this.#committedLength = 0;
      this.#carry = '';
      this.#unpunctuatedSticky = false;
      this.#lastLine = '';
    }

    // ---- 内部処理 -------------------------------------------------------

    /** 表示中の字幕が「繰り上がった」または「入れ替わった」ときの処理 */
    #replaceVisible(previous, text) {
      // 繰り上がりなら、前の字幕の末尾が、新しい字幕の先頭に残っている
      let overlap = 0;
      const maxOverlap = Math.min(previous.length, text.length);
      for (let length = maxOverlap; length >= this.#limits.minOverlap; length--) {
        if (previous.endsWith(text.slice(0, length))) {
          overlap = length;
          break;
        }
      }
      // 画面から消えた先頭部分の長さ(重なりがなければ、前の字幕の全部)
      const goneLength = previous.length - overlap;
      this.#moveToCarry(previous, goneLength);
      this.#committedLength = Math.max(0, this.#committedLength - goneLength);
      this.#visible = text;
    }

    /** previous の未確定部分のうち、先頭から endIndex までが画面から消えた。carry へ回す */
    #moveToCarry(previous, endIndex) {
      if (endIndex <= this.#committedLength) return;
      const gone = previous.slice(this.#committedLength, endIndex).trim();
      this.#carry = T.joinText(this.#carry, gone);
    }

    /** 未確定の字幕から、文末記号までを 1 文ずつ確定する */
    #extractSentences() {
      // 確定済みの直後の空白を読み飛ばす
      let tail = this.#visible.slice(this.#committedLength);
      this.#committedLength += tail.length - tail.trimStart().length;
      tail = tail.trimStart();

      const combined = T.joinText(this.#carry, tail);
      const carryPrefixLength = this.#carryPrefixLength(tail);

      let consumed = 0;
      for (const end of T.findSentenceEnds(combined)) {
        this.#emit(combined.slice(consumed, end));
        consumed = end;
      }

      if (consumed > 0) {
        this.#unpunctuatedSticky = false;
        if (consumed >= carryPrefixLength) {
          // carry を使い切り、表示中の字幕の先頭も確定した
          this.#committedLength += consumed - carryPrefixLength;
          this.#carry = '';
        } else {
          this.#carry = this.#carry.slice(consumed).trim();
        }
      }

      // 文末が来ないまま長くなったら、途中でも区切る。以後は句読点なしの字幕として扱う
      const limit = this.isUnpunctuated ? this.#limits.maxPendingUnpunctuated : this.#limits.maxPending;
      if (this.pending.length > limit) {
        this.commitPending();
        this.#unpunctuatedSticky = true;
      }
    }

    /** `carry + 区切り` の長さ。combined のうち carry が占める先頭部分 */
    #carryPrefixLength(tail) {
      if (!this.#carry) return 0;
      return tail ? this.#carry.length + T.separatorFor(this.#carry, tail).length : this.#carry.length;
    }

    /** 1 行を確定して通知する。直前と同じ行は捨てる */
    #emit(text) {
      const line = T.collapseWhitespace(text);
      if (!line || line === this.#lastLine) return;
      this.#lastLine = line;
      this.#onCommit(line);
    }
  }

  YCO.CaptionHistory = CaptionHistory;
})(globalThis);
