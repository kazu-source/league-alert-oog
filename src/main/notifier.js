'use strict';

/**
 * Fires planned notifications, honouring per-reminder delays.
 *
 * Delayed reminders are cancellable: if the next game starts before a reminder
 * is due, "stand up and stretch" should not pop up in the middle of it.
 */
class Notifier {
  /**
   * @param {object} deps
   * @param {(options:{title:string,body:string,silent:boolean}) => {show:Function}} deps.createNotification
   */
  constructor({ createNotification, setTimer = setTimeout, clearTimer = clearTimeout, onShow = () => {} }) {
    this.createNotification = createNotification;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onShow = onShow;
    this.pending = new Map();
  }

  /**
   * @param {Array<{id:string,title:string,body:string,delayMs:number}>} notifications
   * @param {{silent?:boolean}} [options]
   * @returns {number} how many were shown immediately
   */
  schedule(notifications, { silent = false } = {}) {
    let immediate = 0;
    for (const notification of notifications) {
      if (notification.delayMs > 0) {
        const timer = this.setTimer(() => {
          this.pending.delete(notification.id);
          this.#show(notification, silent);
        }, notification.delayMs);
        this.pending.set(notification.id, timer);
      } else {
        immediate += 1;
        this.#show(notification, silent);
      }
    }
    return immediate;
  }

  /** @returns {number} how many queued reminders were dropped */
  cancelPending() {
    const count = this.pending.size;
    for (const timer of this.pending.values()) this.clearTimer(timer);
    this.pending.clear();
    return count;
  }

  get pendingCount() {
    return this.pending.size;
  }

  #show(notification, silent) {
    try {
      const handle = this.createNotification({
        title: notification.title,
        body: notification.body,
        silent,
      });
      if (handle && typeof handle.show === 'function') handle.show();
      this.onShow(notification);
    } catch (error) {
      // A failed toast must never take the watcher down with it.
      console.error('[league-alert] notification failed:', error);
    }
  }
}

module.exports = { Notifier };
