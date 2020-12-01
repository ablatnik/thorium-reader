// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import classNames from "classnames";
import * as React from "react";
import { connect } from "react-redux";
import { authActions } from "readium-desktop/common/redux/actions";
import * as styles from "readium-desktop/renderer/assets/styles/settings.css";
import {
    TranslatorProps, withTranslator,
} from "readium-desktop/renderer/common/components/hoc/translator";
import { ILibraryRootState } from "readium-desktop/renderer/library/redux/states";
import { TDispatch } from "readium-desktop/typings/redux";

// tslint:disable-next-line: no-empty-interface
interface IBaseProps extends TranslatorProps {
}
// IProps may typically extend:
// RouteComponentProps
// ReturnType<typeof mapStateToProps>
// ReturnType<typeof mapDispatchToProps>
// tslint:disable-next-line: no-empty-interface
interface IProps extends IBaseProps, ReturnType<typeof mapStateToProps>, ReturnType<typeof mapDispatchToProps> {
}

class AuthSettings extends React.Component<IProps> {

    constructor(props: IProps) {
        super(props);
    }

    public render(): React.ReactElement<{}> {
        const { __ } = this.props;
        return (
            <>
                <h3>{__("settings.auth.wipeData")}</h3>
                <section className={styles.keyboard_shortcuts_section}>
                    <button
                        className={
                            classNames(styles.keyboard_shortcuts_button,
                                styles.keyboard_shortcuts_button_primary)
                        }
                        onClick={() => this.props.wipeData()}>
                        {__("settings.auth.wipeData")}
                    </button>
                </section>
            </>
        );
    }
}

const mapStateToProps = (_state: ILibraryRootState, _props: IBaseProps) => {
    return {
    };
};

const mapDispatchToProps = (dispatch: TDispatch, _props: IBaseProps) => {
    return {
        wipeData: () => dispatch(authActions.wipeData.build()),
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(withTranslator(AuthSettings));
