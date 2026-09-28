/** Runs before «Далее» leaves a step; false keeps the owner on it */
export type NextHandler = () => Promise<boolean>;

export type StepProps = {
  /** A step that saves on «Далее» (the clinic form) registers its handler */
  registerNext: (handler: NextHandler | null) => void;
};
