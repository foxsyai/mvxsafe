import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { afterSignIn } from 'helpers/provenSignIn';
import { UnlockPanelManager, useGetLoginInfo } from 'lib';
import { ALLOWED_WALLETS } from 'lib/sdkDapp/sdkDapp.constants';
import { RouteNamesEnum } from 'localConstants';

export const Unlock = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useGetLoginInfo();

  const unlockPanelManager = UnlockPanelManager.init({
    allowedProviders: ALLOWED_WALLETS,
    // Every sign-in is checked before the app acts as its address (SIN-01).
    loginHandler: async () => {
      await afterSignIn();
      navigate(RouteNamesEnum.home);
    },
    onClose: async () => {
      navigate(RouteNamesEnum.home);
    }
  });

  const handleOpenUnlockPanel = () => {
    unlockPanelManager.openUnlockPanel();
  };

  useEffect(() => {
    if (isLoggedIn) {
      navigate(RouteNamesEnum.home);
      return;
    }

    handleOpenUnlockPanel();
  }, [isLoggedIn]);

  return null;
};
